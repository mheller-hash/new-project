/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, GenerateContentResponse, Modality, Type } from "@google/genai";
import { 
  Send, 
  Image as ImageIcon, 
  Type as TypeIcon, 
  Layout, 
  Sparkles, 
  RefreshCw, 
  Download, 
  MessageSquare,
  ChevronRight,
  Loader2,
  AlertCircle,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Types
interface Campaign {
  subject: string;
  body: string;
  imagePrompt: string;
  imageUrl?: string;
}

interface Message {
  role: 'user' | 'model';
  text: string;
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkApiKey();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const checkApiKey = async () => {
    try {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
    } catch (e) {
      console.error("Error checking API key:", e);
    }
  };

  const handleOpenKeyDialog = async () => {
    await window.aistudio.openSelectKey();
    setHasApiKey(true);
  };

  const generateCampaign = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // 1. Generate Copy
      const copyResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate a marketing email campaign based on this prompt: "${prompt}". 
        Return the result as a JSON object with 'subject', 'body' (markdown), and 'imagePrompt' (a detailed description for an AI image generator).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subject: { type: Type.STRING },
              body: { type: Type.STRING },
              imagePrompt: { type: Type.STRING }
            },
            required: ["subject", "body", "imagePrompt"]
          }
        }
      });

      const campaignData = JSON.parse(copyResponse.text);
      setCampaign(campaignData);

      // 2. Generate Image (if API key is selected)
      if (hasApiKey) {
        await generateImage(campaignData.imagePrompt, campaignData);
      }
    } catch (err: any) {
      console.error("Generation error:", err);
      setError("Failed to generate campaign. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const generateImage = async (imagePrompt: string, currentCampaign: Campaign) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: {
          parts: [{ text: imagePrompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: imageSize
          }
        }
      });

      let imageUrl = "";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (imageUrl) {
        setCampaign({ ...currentCampaign, imageUrl });
      }
    } catch (err: any) {
      console.error("Image generation error:", err);
      if (err.message?.includes("Requested entity was not found")) {
        setHasApiKey(false);
      }
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim() || !campaign) return;
    
    const userMsg: Message = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatting(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const chat = ai.chats.create({
        model: "gemini-3.1-pro-preview",
        config: {
          systemInstruction: `You are an expert marketing consultant. You are helping the user refine an email campaign. 
          The current campaign is:
          Subject: ${campaign.subject}
          Body: ${campaign.body}
          
          When the user asks for changes, provide constructive feedback and then output the updated campaign in JSON format at the end of your message, wrapped in <CAMPAIGN_JSON> tags.
          The JSON should have 'subject', 'body', and 'imagePrompt'.`
        }
      });

      // Send history
      const history = chatHistory.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const response = await chat.sendMessage({
        message: chatInput
      });

      const responseText = response.text;
      const modelMsg: Message = { role: 'model', text: responseText };
      setChatHistory(prev => [...prev, modelMsg]);

      // Extract JSON if present
      const jsonMatch = responseText.match(/<CAMPAIGN_JSON>([\s\S]*?)<\/CAMPAIGN_JSON>/);
      if (jsonMatch) {
        try {
          const updatedCampaign = JSON.parse(jsonMatch[1]);
          setCampaign(prev => ({ ...prev!, ...updatedCampaign }));
          
          // Re-generate image if prompt changed significantly
          if (hasApiKey && updatedCampaign.imagePrompt !== campaign.imagePrompt) {
            generateImage(updatedCampaign.imagePrompt, { ...campaign, ...updatedCampaign });
          }
        } catch (e) {
          console.error("Failed to parse updated campaign JSON", e);
        }
      }
    } catch (err) {
      console.error("Chat error:", err);
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E6F0FA] text-[#1A1A1A] font-sans">
      {/* Header */}
      <header className="border-b border-[#E5E5E5] bg-white px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#1A1A1A] rounded-lg flex items-center justify-center">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">CampaignCraft AI</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {!hasApiKey && (
            <button 
              onClick={handleOpenKeyDialog}
              className="flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors"
            >
              <Key size={16} />
              <span>Connect API Key for Images</span>
            </button>
          )}
          <div className="flex items-center gap-2 bg-[#F0F0F0] rounded-full px-3 py-1">
            <span className="text-[10px] uppercase font-bold tracking-widest text-[#666]">Image Size</span>
            <select 
              value={imageSize} 
              onChange={(e) => setImageSize(e.target.value as any)}
              className="bg-transparent text-xs font-semibold outline-none cursor-pointer"
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input & Controls */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-[#E5E5E5]">
            <label className="block text-xs font-bold uppercase tracking-widest text-[#666] mb-3">
              Campaign Goal
            </label>
            <textarea 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., A summer sale for eco-friendly yoga mats with a 20% discount code 'SUMMER20'..."
              className="w-full h-32 p-4 rounded-xl bg-[#F9F9F9] border border-[#EEEEEE] focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A] outline-none transition-all resize-none text-sm leading-relaxed"
            />
            <button 
              onClick={generateCampaign}
              disabled={isGenerating || !prompt.trim()}
              className="w-full mt-4 bg-[#1A1A1A] text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isGenerating ? (
                <Loader2 className="animate-spin w-5 h-5" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
              <span>{campaign ? 'Regenerate Campaign' : 'Generate Campaign'}</span>
            </button>
          </section>

          {campaign && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-[#E5E5E5] flex flex-col h-[500px]">
              <label className="block text-xs font-bold uppercase tracking-widest text-[#666] mb-3 flex items-center gap-2">
                <MessageSquare size={14} />
                Refine with AI
              </label>
              
              <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 custom-scrollbar">
                {chatHistory.length === 0 && (
                  <div className="text-center py-8 text-[#999] text-sm italic">
                    Ask for changes like "Make the tone more professional" or "Add a call to action button".
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                      msg.role === 'user' 
                        ? 'bg-[#1A1A1A] text-white rounded-tr-none' 
                        : 'bg-[#F0F0F0] text-[#1A1A1A] rounded-tl-none'
                    }`}>
                      {msg.text.replace(/<CAMPAIGN_JSON>[\s\S]*?<\/CAMPAIGN_JSON>/, '').trim()}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div className="relative">
                <input 
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleChat()}
                  placeholder="Type a refinement..."
                  className="w-full p-3 pr-12 rounded-xl bg-[#F9F9F9] border border-[#EEEEEE] focus:border-[#1A1A1A] outline-none text-sm"
                />
                <button 
                  onClick={handleChat}
                  disabled={isChatting || !chatInput.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#1A1A1A] hover:bg-[#EEE] rounded-lg transition-all disabled:opacity-30"
                >
                  {isChatting ? <Loader2 className="animate-spin w-4 h-4" /> : <Send size={18} />}
                </button>
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            {!campaign ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="h-full min-h-[600px] bg-white rounded-3xl border-2 border-dashed border-[#E5E5E5] flex flex-col items-center justify-center p-12 text-center"
              >
                <div className="w-20 h-20 bg-[#C3DAF5] rounded-full flex items-center justify-center mb-6">
                  <Layout className="text-[#CCC] w-10 h-10" />
                </div>
                <h2 className="text-2xl font-semibold mb-2">Ready to create?</h2>
                <p className="text-[#666] max-w-md">
                  Enter a prompt on the left to generate your first email marketing campaign. We'll handle the copy and the visuals.
                </p>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-3xl shadow-xl border border-[#E5E5E5] overflow-hidden flex flex-col h-full"
              >
                {/* Preview Header */}
                <div className="bg-[#1A1A1A] text-white px-8 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]"></div>
                    </div>
                    <span className="text-xs font-medium opacity-60 ml-2">Email Preview</span>
                  </div>
                  <div className="flex gap-4">
                    <button className="text-xs font-bold uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity flex items-center gap-2">
                      <Download size={14} />
                      Export
                    </button>
                  </div>
                </div>

                {/* Email Content */}
                <div className="flex-1 overflow-y-auto p-8 lg:p-12 space-y-8">
                  {/* Subject Line */}
                  <div className="pb-6 border-b border-[#F0F0F0]">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-[#999] block mb-1">Subject Line</span>
                    <h3 className="text-xl font-semibold text-[#1A1A1A]">{campaign.subject}</h3>
                  </div>

                  {/* Hero Image */}
                  <div className="relative aspect-video bg-[#F9F9F9] rounded-2xl overflow-hidden group">
                    {campaign.imageUrl ? (
                      <img 
                        src={campaign.imageUrl} 
                        alt="Campaign Visual" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center">
                          <ImageIcon className="text-[#CCC]" />
                        </div>
                        <p className="text-xs text-[#999] font-medium">
                          {hasApiKey ? 'Generating high-quality visual...' : 'Connect API key to generate visual'}
                        </p>
                        {!hasApiKey && (
                          <button 
                            onClick={handleOpenKeyDialog}
                            className="text-xs bg-[#1A1A1A] text-white px-4 py-2 rounded-lg font-semibold hover:bg-[#333] transition-all"
                          >
                            Connect Key
                          </button>
                        )}
                      </div>
                    )}
                    {campaign.imageUrl && (
                      <button 
                        onClick={() => generateImage(campaign.imagePrompt, campaign)}
                        className="absolute bottom-4 right-4 bg-white/90 backdrop-blur p-2 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-white"
                        title="Regenerate Image"
                      >
                        <RefreshCw size={16} className="text-[#1A1A1A]" />
                      </button>
                    )}
                  </div>

                  {/* Email Body */}
                  <div className="prose prose-sm max-w-none">
                    <div className="text-[#333] leading-relaxed whitespace-pre-wrap text-base">
                      {campaign.body}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="pt-12 border-t border-[#F0F0F0] text-center">
                    <p className="text-[10px] text-[#999] uppercase tracking-[0.2em] font-medium">
                      Generated by CampaignCraft AI
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {error && (
        <div className="fixed bottom-6 right-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
          <AlertCircle size={20} />
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E5E5;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #CCC;
        }
      `}</style>
    </div>
  );
}
