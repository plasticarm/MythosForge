
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse, Modality, Type } from "@google/genai";
import { User, DetailLevel, AppMode, CharacterData, EnvironmentData, PropData, GlobalData, SavedElement, StoryData, Session, Message } from './types';
import { RANDOM_POOL, PROMPT_TEMPLATES } from './constants';

// --- Utilities ---
const decode = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const playAudio = async (base64Data: string) => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const bytes = decode(base64Data);
    const buffer = await audioContext.decodeAudioData(bytes.buffer);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
  } catch (e) {
    console.error("Audio playback error:", e);
  }
};

const downloadAudio = (base64Data: string, filename: string, isElevenLabs = false) => {
  try {
    const bytes = decode(base64Data);
    let blob;
    if (isElevenLabs) {
        blob = new Blob([bytes], { type: 'audio/mpeg' });
    } else {
        const header = new ArrayBuffer(44);
        blob = new Blob([bytes], { type: 'audio/wav' });
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download error:", e);
  }
};

const cropImage = (base64Image: string, quadrant: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const w = img.width / 2;
      const h = img.height / 2;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject("No context"); return; }
      
      // Quadrants: 1=TL, 2=TR, 3=BL, 4=BR
      // Map 1-4 to x,y coordinates
      const qIndex = quadrant - 1; 
      const x = (qIndex % 2) * w;
      const y = Math.floor(qIndex / 2) * h;
      
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (e) => reject(e);
    img.src = base64Image;
  });
};

const useClickOutside = (ref: React.RefObject<HTMLElement | null>, handler: () => void) => {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
};

// --- Components ---

const AuthModal: React.FC<{ isOpen: boolean; onClose: () => void; onLogin: (user: User) => void; }> = ({ isOpen, onClose, onLogin }) => {
  if (!isOpen) return null;
  const handleMockLogin = () => {
    const mockUser: User = { id: 'user_123', email: 'creator@mythosforge.ai', name: 'Mythic Creator', picture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Mythos', apiKeys: {} };
    onLogin(mockUser);
    onClose();
  };
  return (
    <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-4">
          <div className="w-20 h-20 bg-yellow-500 rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-yellow-500/20 rotate-3"><i className="fa-solid fa-bolt text-slate-950 text-4xl"></i></div>
          <h2 className="text-4xl font-black text-white tracking-tighter">Enter the Forge</h2>
          <p className="text-slate-400 text-lg">Synchronize your chronicles across the multiversal cloud.</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl space-y-6">
           <button onClick={handleMockLogin} className="w-full flex items-center justify-center gap-4 bg-white text-slate-900 py-4 rounded-xl font-bold hover:bg-slate-100 transition-all transform active:scale-95"><i className="fa-brands fa-google text-xl"></i>Sign in with Google</button>
           <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div><div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-500 font-bold tracking-widest">Or Continue As</span></div></div>
           <button onClick={onClose} className="w-full py-4 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 transition-all">Guest Architect</button>
        </div>
        <p className="text-[10px] text-slate-600 uppercase tracking-[0.2em] font-black">Secure • Encrypted • Multiversal</p>
      </div>
    </div>
  );
};

const SessionModal: React.FC<{ isOpen: boolean; onClose: () => void; sessions: Session[]; currentName: string; onRename: (name: string) => void; onSave: () => void; onLoad: (session: Session) => void; onDelete: (id: string) => void; onNew: () => void; }> = ({ isOpen, onClose, sessions, currentName, onRename, onSave, onLoad, onDelete, onNew }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  useClickOutside(modalRef, onClose);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div ref={modalRef} className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center"><h2 className="text-xl font-bold text-white">Chronicle Manager</h2><button onClick={onClose} className="text-slate-500 hover:text-white"><i className="fa-solid fa-xmark"></i></button></div>
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Current Workspace Name</label>
            <div className="flex gap-2">
              <input type="text" value={currentName} onChange={(e) => onRename(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/30" />
              <button onClick={onSave} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-500 transition-colors">Save</button>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center"><label className="text-xs font-bold text-slate-500 uppercase">Saved Chronicles</label><button onClick={onNew} className="text-xs font-bold text-yellow-500 hover:text-yellow-400"> + New Chronicle</button></div>
            <div className="grid gap-3">
              {sessions.length === 0 ? <div className="text-center py-8 text-slate-600 border border-dashed border-slate-800 rounded-xl">No saved chronicles found.</div> : sessions.map(s => (
                  <div key={s.id} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex justify-between items-center group hover:border-indigo-500/50 transition-all">
                    <div><div className="font-bold text-slate-200">{s.name}</div><div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">{new Date(s.lastModified).toLocaleString()}</div></div>
                    <div className="flex gap-2"><button onClick={() => onLoad(s)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 rounded-lg transition-all">Load</button><button onClick={() => onDelete(s.id)} className="p-2 text-slate-600 hover:text-red-500 transition-colors"><i className="fa-solid fa-trash"></i></button></div>
                  </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false); 
  const profileRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<AppMode>(AppMode.GLOBALS);
  const [level, setLevel] = useState<DetailLevel>(DetailLevel.SIMPLE);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [activeFooterTab, setActiveFooterTab] = useState(0);

  // --- Session State ---
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionName, setCurrentSessionName] = useState('New Chronicle');

  // --- AI State ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Storyboard State ---
  const [storyboardScene, setStoryboardScene] = useState('');

  useClickOutside(profileRef, () => setIsProfileOpen(false));

  const initialGlobalData: GlobalData = { 
    style: '', timePeriod: '', genre: '', lightingTheme: '', colorPalette: '', customApiKey: '',
    elevenLabsApiKey: '', aspectRatio: '1:1', imageQuality: '1K', styleReferenceImages: [],
    googleSheetUrl: '', googleClientId: ''
  };
  
  const initialCharData: CharacterData = { 
    id: undefined, name: '', species: '', age: '', role: '', archetype: '', physicalDescription: '', personality: '', motivation: '', flaws: '', backstory: '', speechPatterns: '', secrets: '', visualStyle: '', keyActions: '', hairColor: '', eyeColor: '', height: '', build: '', distinguishingFeatures: '',
    skinTone: '', tattoosMarkings: '', clothingStyle: '', postureGait: '', scent: '', alignment: '', phobias: '', hobbies: '', intelligence: '', placeOfBirth: '', socialClass: '', beliefs: '', languages: '', signatureWeapon: '', specialAbilities: '', combatStyle: '', reputation: '', allies: '', enemies: '', petCompanion: '',
    voiceProvider: 'Gemini', voiceProfile: 'Puck', elevenLabsVoiceId: '', voiceDescription: '', customImage: '', additionalDetails: ''
  };

  const initialEnvData: EnvironmentData = { id: undefined, name: '', biome: '', timeOfDay: '', weather: '', atmosphere: '', architecture: '', landmarks: '', history: '', lighting: '', visualStyle: '', scale: '', colors: '', customImage: '', additionalDetails: '' };
  const initialPropData: PropData = { id: undefined, name: '', category: '', material: '', size: '', weight: '', condition: '', origin: '', properties: '', visualDetails: '', history: '', visualStyle: '', customImage: '', additionalDetails: '' };

  const [globalData, setGlobalData] = useState<GlobalData>(initialGlobalData);
  const [charData, setCharData] = useState<CharacterData>(initialCharData);
  const [characterLibrary, setCharacterLibrary] = useState<CharacterData[]>([]);
  const [envData, setEnvData] = useState<EnvironmentData>(initialEnvData);
  const [environmentLibrary, setEnvironmentLibrary] = useState<EnvironmentData[]>([]);
  const [propData, setPropData] = useState<PropData>(initialPropData);
  const [propLibrary, setPropLibrary] = useState<PropData[]>([]);
  const [storyData, setStoryData] = useState<StoryData>({ synopsis: '', fullStory: '', storyScenes: [] });
  const [savedElements, setSavedElements] = useState<SavedElement[]>([]);

  // --- Logic Hooks ---
  const showIntermediate = level === DetailLevel.INTERMEDIATE || level === DetailLevel.COMPLEX;
  const showComplex = level === DetailLevel.COMPLEX;

  useEffect(() => {
    const savedUser = localStorage.getItem('mythos_forge_user');
    if (savedUser) setUser(JSON.parse(savedUser));
    else setIsAuthModalOpen(true);
  }, []);

  useEffect(() => {
    const ownerId = user?.id || 'guest';
    const saved = localStorage.getItem(`mythos_sessions_${ownerId}`);
    if (saved) { try { setSessions(JSON.parse(saved)); } catch (e) { console.error(e); } }
    else setSessions([]);

    if (user?.apiKeys) {
        setGlobalData(prev => ({
            ...prev,
            customApiKey: user.apiKeys.gemini || prev.customApiKey,
            elevenLabsApiKey: user.apiKeys.elevenLabs || prev.elevenLabsApiKey
        }));
    }
  }, [user]);

  const saveSessionsToStorage = (updatedSessions: Session[]) => {
    const ownerId = user?.id || 'guest';
    localStorage.setItem(`mythos_sessions_${ownerId}`, JSON.stringify(updatedSessions));
    setSessions(updatedSessions);
  };

  const handleLogin = (newUser: User) => { localStorage.setItem('mythos_forge_user', JSON.stringify(newUser)); setUser(newUser); };
  const handleLogout = () => { if (window.confirm("Disconnect?")) { localStorage.removeItem('mythos_forge_user'); setUser(null); setIsAuthModalOpen(true); } };

  const handleSaveSession = () => {
    const sessionData: Session = { id: Date.now().toString(), userId: user?.id || 'guest', name: currentSessionName || 'Untitled Session', lastModified: Date.now(), data: { mode, globalData, charData, characterLibrary, envData, environmentLibrary, propData, propLibrary, storyData, savedElements, chatMessages } };
    const existingIndex = sessions.findIndex(s => s.name === sessionData.name);
    let newSessions = existingIndex >= 0 ? [...sessions] : [...sessions, sessionData];
    if (existingIndex >= 0) newSessions[existingIndex] = sessionData;
    saveSessionsToStorage(newSessions);
  };

  const handleUpdateKeys = (gemini?: string, eleven?: string) => {
    if (user) {
        const updatedUser = { ...user, apiKeys: { ...user.apiKeys, gemini: gemini || user.apiKeys.gemini, elevenLabs: eleven || user.apiKeys.elevenLabs } };
        setUser(updatedUser);
        localStorage.setItem('mythos_forge_user', JSON.stringify(updatedUser));
    }
    setGlobalData(prev => ({ ...prev, customApiKey: gemini || prev.customApiKey, elevenLabsApiKey: eleven || prev.elevenLabsApiKey }));
  };

  const handleLoadSession = (session: Session) => {
    if (window.confirm(`Manifest chronicle "${session.name}"?`)) {
      setMode(session.data.mode); setGlobalData(session.data.globalData); setCharData(session.data.charData); setCharacterLibrary(session.data.characterLibrary || []); setEnvData(session.data.envData); setEnvironmentLibrary(session.data.environmentLibrary || []); setPropData(session.data.propData); setPropLibrary(session.data.propLibrary || []); setStoryData(session.data.storyData); setSavedElements(session.data.savedElements); setChatMessages(session.data.chatMessages); setCurrentSessionName(session.name); setIsSessionMenuOpen(false);
    }
  };
  const handleDeleteSession = (id: string) => { if (window.confirm("Purge?")) { saveSessionsToStorage(sessions.filter(s => s.id !== id)); } };
  const handleNewSession = () => { if (window.confirm("Fresh chronicle?")) { setGlobalData(initialGlobalData); setCharData(initialCharData); setCharacterLibrary([]); setEnvData(initialEnvData); setEnvironmentLibrary([]); setPropData(initialPropData); setPropLibrary([]); setStoryData({ synopsis: '', fullStory: '', storyScenes: [] }); setSavedElements([]); setChatMessages([]); setCurrentSessionName('New Chronicle'); setMode(AppMode.GLOBALS); setIsSessionMenuOpen(false); } };

  // Asset Handlers
  const saveCharacter = () => {
      const newChar = { ...charData, id: charData.id || Date.now().toString() };
      setCharacterLibrary(prev => { const idx = prev.findIndex(c => c.id === newChar.id); const updated = idx >= 0 ? [...prev] : [...prev, newChar]; if (idx >= 0) updated[idx] = newChar; return updated; });
      setCharData(newChar);
  };
  const loadCharacter = (id: string) => { const found = characterLibrary.find(c => c.id === id); if (found) setCharData(found); else setCharData(initialCharData); };
  const deleteCharacter = () => { if (window.confirm("Delete character?")) { setCharacterLibrary(prev => prev.filter(c => c.id !== charData.id)); setCharData(initialCharData); } };
  const newCharacter = () => setCharData(initialCharData);

  const saveEnvironment = () => {
      const newEnv = { ...envData, id: envData.id || Date.now().toString() };
      setEnvironmentLibrary(prev => { const idx = prev.findIndex(e => e.id === newEnv.id); const updated = idx >= 0 ? [...prev] : [...prev, newEnv]; if (idx >= 0) updated[idx] = newEnv; return updated; });
      setEnvData(newEnv);
  };
  const loadEnvironment = (id: string) => { const found = environmentLibrary.find(e => e.id === id); if (found) setEnvData(found); else setEnvData(initialEnvData); };
  const deleteEnvironment = () => { if (window.confirm("Delete environment?")) { setEnvironmentLibrary(prev => prev.filter(e => e.id !== envData.id)); setEnvData(initialEnvData); } };
  const newEnvironment = () => setEnvData(initialEnvData);

  const saveProp = () => {
      const newProp = { ...propData, id: propData.id || Date.now().toString() };
      setPropLibrary(prev => { const idx = prev.findIndex(p => p.id === newProp.id); const updated = idx >= 0 ? [...prev] : [...prev, newProp]; if (idx >= 0) updated[idx] = newProp; return updated; });
      setPropData(newProp);
  };
  const loadProp = (id: string) => { const found = propLibrary.find(p => p.id === id); if (found) setPropData(found); else setPropData(initialPropData); };
  const deleteProp = () => { if (window.confirm("Delete prop?")) { setPropLibrary(prev => prev.filter(p => p.id !== propData.id)); setPropData(initialPropData); } };
  const newProp = () => setPropData(initialPropData);

  const handleSaveElement = (type: AppMode, name: string, desc: string, imageUrl: string) => { setSavedElements(prev => [...prev, { id: Date.now().toString(), type, name, description: desc, imageUrl }]); };

  const checkKey = async () => { if ((window.aistudio && await window.aistudio.hasSelectedApiKey()) || (globalData.customApiKey && globalData.customApiKey.length > 10)) setHasKey(true); else setHasKey(false); };
  useEffect(() => { checkKey(); }, [globalData.customApiKey]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, isTyping]);
  const getApiKey = () => globalData.customApiKey?.trim() || process.env.API_KEY || "";
  const copyToClipboard = (text: string, index: number) => { navigator.clipboard.writeText(text); setCopiedIndex(index); setTimeout(() => setCopiedIndex(null), 2000); };
  const handleOpenKey = async () => { if (window.aistudio) { await window.aistudio.openSelectKey(); await checkKey(); } };

  const sendToAI = async (text: string, isStoryGen = false) => {
    setIsChatOpen(true); setChatMessages(prev => [...prev, { role: 'user', text }]); setChatInput(''); setIsTyping(true);
    try {
      const apiKey = getApiKey(); const ai = new GoogleGenAI({ apiKey });
      let contents;
      if (isStoryGen) { const context = savedElements.map(el => `[Saved ${el.type}]: ${el.name} - ${el.description}`).join('\n'); contents = [{ parts: [{ text: PROMPT_TEMPLATES.storyGen(text, context) }], role: 'user' }]; }
      else contents = [...chatMessages.map(m => ({ parts: [{ text: m.text }], role: m.role })), { parts: [{ text }], role: 'user' }];
      const stream = await ai.models.generateContentStream({ model: 'gemini-3-pro-preview', contents });
      let fullText = ''; setChatMessages(prev => [...prev, { role: 'model', text: '' }]);
      for await (const chunk of stream) { if (chunk.text) { fullText += chunk.text; setChatMessages(prev => { const last = prev[prev.length - 1]; return [...prev.slice(0, -1), { ...last, text: fullText }]; }); } }
      if (isStoryGen) setStoryData(prev => ({ ...prev, fullStory: fullText }));
    } catch (error: any) { setChatMessages(prev => [...prev, { role: 'model', text: `Error: ${error.message}.`, status: 'error' }]); } finally { setIsTyping(false); }
  };

  const analyzeStory = async () => {
    if (!storyData.fullStory) return;
    const apiKey = getApiKey();
    if (!hasKey && !apiKey) { await handleOpenKey(); return; }
    
    setIsTyping(true);
    setGenStatus('Deconstructing narrative...');
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: storyData.fullStory,
        config: {
          systemInstruction: "You are a storyboard director. Analyze the provided story and break it down into a list of 4-8 visual scene descriptions suitable for generating storyboard panels. Return ONLY a JSON array of strings.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      });
      
      if (response.text) {
        const scenes = JSON.parse(response.text);
        setStoryData(prev => ({ ...prev, storyScenes: scenes }));
      }
    } catch (error: any) {
      setChatMessages(prev => [...prev, { role: 'model', text: `Analysis Failed: ${error.message}.`, status: 'error' }]);
    } finally {
      setIsTyping(false);
      setGenStatus('');
    }
  };

  const generateVoice = async (textToSpeak: string) => {
    const apiKey = getApiKey(); if (!hasKey && !apiKey && charData.voiceProvider === 'Gemini') { await handleOpenKey(); return; }
    const spokenText = textToSpeak || `${charData.name}. ${charData.personality}`;
    setIsChatOpen(true); setIsTyping(true); setGenStatus(`Voice synthesis active...`);
    try {
      let base64Audio = "";
      if (charData.voiceProvider === 'ElevenLabs') {
          if (!globalData.elevenLabsApiKey || !charData.elevenLabsVoiceId) throw new Error("Missing ElevenLabs credentials.");
          const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${charData.elevenLabsVoiceId}`, { method: 'POST', headers: { 'xi-api-key': globalData.elevenLabsApiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: spokenText, model_id: "eleven_monolingual_v1" }) });
          if (!response.ok) throw new Error("ElevenLabs API failure.");
          const blob = await response.blob(); const arrayBuffer = await blob.arrayBuffer(); let binary = ''; const bytes = new Uint8Array(arrayBuffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } base64Audio = btoa(binary);
      } else {
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({ model: "gemini-2.5-flash-preview-tts", contents: { parts: [{ text: spokenText }] }, config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: charData.voiceProfile } } } } });
          base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
      }
      if (base64Audio) { await playAudio(base64Audio); setChatMessages(prev => [...prev, { role: 'model', text: `Audio generated.`, audioData: base64Audio }]); } else throw new Error("No audio data.");
    } catch (error: any) { setChatMessages(prev => [...prev, { role: 'model', text: `Voice Error: ${error.message}.`, status: 'error' }]); } finally { setIsTyping(false); setGenStatus(''); }
  };

  const generateImage = async (promptText: string, options: { isStoryboard?: boolean, isMultiView?: boolean, specificRef?: string, imageInput?: string } = {}) => {
    const { isStoryboard = false, isMultiView = false, specificRef, imageInput } = options;
    const apiKey = getApiKey(); if (!hasKey && !apiKey) { await handleOpenKey(); return; }
    let uploadedRef: string | undefined; if (mode === AppMode.CHARACTER) uploadedRef = charData.customImage; else if (mode === AppMode.ENVIRONMENT) uploadedRef = envData.customImage; else if (mode === AppMode.PROP) uploadedRef = propData.customImage;
    
    // Context building
    const savedContext = savedElements.map(e => `[Saved ${e.type} Reference]: ${e.name} - ${e.description}`).join('\n');
    const fullContextPrompt = `Context from Registry:\n${savedContext}\n\nScene Description: ${promptText}`;

    setIsChatOpen(true); setIsTyping(true); setGenStatus(imageInput ? 'Upscaling Detail...' : 'Visual manifesting...');
    try {
      const ai = new GoogleGenAI({ apiKey }); const contents: any = { parts: [] }; let promptPrefix = "";
      if (globalData.styleReferenceImages.length > 0) { globalData.styleReferenceImages.forEach(imgData => { contents.parts.push({ inlineData: { data: imgData.split(',')[1], mimeType: imgData.split(';')[0].split(':')[1] } }); }); promptPrefix += ` Use provided visual style.`; }
      
      if (imageInput) {
        contents.parts.push({ inlineData: { data: imageInput.split(',')[1], mimeType: 'image/png' } });
        promptPrefix += " Refine and upscale this composition. ";
      } else if (specificRef) {
        contents.parts.push({ inlineData: { data: specificRef.split(',')[1], mimeType: 'image/png' } });
      } else if (uploadedRef) {
        contents.parts.push({ inlineData: { data: uploadedRef.split(',')[1], mimeType: 'image/png' } }); 
      }

      const finalPrompt = isStoryboard 
        ? `${promptPrefix} Comic Book Page Layout: 4-panel grid (2x2). Scene: ${fullContextPrompt}. Style: ${globalData.style}. High contrast, dynamic angles, consistent character details from registry.` 
        : `${promptPrefix} Professional Concept Art: ${fullContextPrompt}. Cinematic, 8k, ${globalData.style}.`; 
      contents.parts.push({ text: finalPrompt });
      
      const response = await ai.models.generateContent({ model: 'gemini-3-pro-image-preview', contents, config: { imageConfig: { aspectRatio: isStoryboard ? "4:3" : globalData.aspectRatio, imageSize: globalData.imageQuality } } });
      let imageUrl = ''; if (response.candidates?.[0]?.content?.parts) { for (const part of response.candidates[0].content.parts) { if (part.inlineData) { imageUrl = `data:image/png;base64,${part.inlineData.data}`; break; } } }
      if (imageUrl) setChatMessages(prev => [...prev, { role: 'model', text: isStoryboard ? `Storyboard generated: ${promptText}` : `Visualized.`, image: imageUrl, isStoryboard, isMultiView }]); else throw new Error("Empty image payload");
    } catch (error: any) { setChatMessages(prev => [...prev, { role: 'model', text: `Visual Failed: ${error.message}.`, status: 'error' }]); } finally { setIsTyping(false); setGenStatus(''); }
  };
  
  const handleUpscaleQuadrant = async (base64Image: string, quadrant: number, originalPrompt: string) => {
    try {
        const croppedImage = await cropImage(base64Image, quadrant);
        generateImage(originalPrompt, { isStoryboard: false, imageInput: croppedImage });
    } catch (e) {
        console.error("Upscale failed", e);
    }
  };

  const getContextName = () => { switch(mode) { case AppMode.CHARACTER: return charData.name || 'Character'; case AppMode.ENVIRONMENT: return envData.name || 'Environment'; case AppMode.PROP: return propData.name || 'Prop'; default: return 'Session'; } };
  const handleImageDownload = (imageUrl: string, isMultiView?: boolean, isStoryboard?: boolean) => { const name = getContextName().replace(/[^a-z0-9]/gi, '_'); const type = isMultiView ? 'MultiView' : isStoryboard ? 'Storyboard' : 'Visual'; const date = new Date().toISOString().slice(0,19).replace(/[:]/g, '-'); const filename = `${name}_${type}_${date}.png`; const link = document.createElement('a'); link.href = imageUrl; link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link); };
  const handleAudioDownload = (base64Data: string, isElevenLabs: boolean) => { const name = getContextName().replace(/[^a-z0-9]/gi, '_'); const date = new Date().toISOString().slice(0,19).replace(/[:]/g, '-'); const filename = `${name}_VoiceSample_${date}.${isElevenLabs ? 'mp3' : 'wav'}`; downloadAudio(base64Data, filename, isElevenLabs); };

  const randomize = async () => {
    const r = RANDOM_POOL;
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

    // 1. Handle Globals Randomization (always random pool since it sets the context)
    if (mode === AppMode.GLOBALS) {
      setGlobalData({
        ...globalData,
        style: pick(r.visualStyles),
        timePeriod: pick(r.timePeriods),
        genre: pick(r.genres),
        lightingTheme: pick(r.lightingThemes)
      });
      return;
    }

    // 2. Context-Aware AI Generation
    const context = `Genre: ${globalData.genre}, Time Period: ${globalData.timePeriod}, Style: ${globalData.style}`;
    const useAI = (globalData.genre || globalData.timePeriod || globalData.style) && (hasKey || getApiKey());

    if (useAI) {
        setIsRandomizing(true);
        try {
             const apiKey = getApiKey();
             const ai = new GoogleGenAI({ apiKey });
             let schema = null;
             let prompt = "";

             if (mode === AppMode.CHARACTER) {
                 prompt = `Generate a detailed RPG character profile fitting this setting: ${context}. Fill all fields. For voiceProfile, pick one of: Puck, Charon, Kore, Fenrir, Zephyr.`;
                 schema = {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        species: { type: Type.STRING },
                        role: { type: Type.STRING },
                        archetype: { type: Type.STRING },
                        personality: { type: Type.STRING },
                        motivation: { type: Type.STRING },
                        flaws: { type: Type.STRING },
                        backstory: { type: Type.STRING },
                        visualStyle: { type: Type.STRING },
                        hairColor: { type: Type.STRING },
                        eyeColor: { type: Type.STRING },
                        height: { type: Type.STRING },
                        build: { type: Type.STRING },
                        distinguishingFeatures: { type: Type.STRING },
                        skinTone: { type: Type.STRING },
                        clothingStyle: { type: Type.STRING },
                        postureGait: { type: Type.STRING },
                        scent: { type: Type.STRING },
                        alignment: { type: Type.STRING },
                        phobias: { type: Type.STRING },
                        hobbies: { type: Type.STRING },
                        intelligence: { type: Type.STRING },
                        placeOfBirth: { type: Type.STRING },
                        socialClass: { type: Type.STRING },
                        beliefs: { type: Type.STRING },
                        languages: { type: Type.STRING },
                        signatureWeapon: { type: Type.STRING },
                        specialAbilities: { type: Type.STRING },
                        combatStyle: { type: Type.STRING },
                        reputation: { type: Type.STRING },
                        allies: { type: Type.STRING },
                        enemies: { type: Type.STRING },
                        petCompanion: { type: Type.STRING },
                        voiceProfile: { type: Type.STRING, enum: ["Puck", "Charon", "Kore", "Fenrir", "Zephyr"] },
                        voiceDescription: { type: Type.STRING }
                    }
                 };
             } else if (mode === AppMode.ENVIRONMENT) {
                 prompt = `Generate a unique location/environment fitting this setting: ${context}.`;
                 schema = {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        biome: { type: Type.STRING },
                        timeOfDay: { type: Type.STRING },
                        weather: { type: Type.STRING },
                        atmosphere: { type: Type.STRING },
                        architecture: { type: Type.STRING },
                        landmarks: { type: Type.STRING },
                        history: { type: Type.STRING },
                        lighting: { type: Type.STRING },
                        visualStyle: { type: Type.STRING },
                        scale: { type: Type.STRING },
                        colors: { type: Type.STRING }
                    }
                 };
             } else if (mode === AppMode.PROP) {
                 prompt = `Generate a unique item/prop fitting this setting: ${context}.`;
                 schema = {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        category: { type: Type.STRING },
                        material: { type: Type.STRING },
                        size: { type: Type.STRING },
                        weight: { type: Type.STRING },
                        condition: { type: Type.STRING },
                        origin: { type: Type.STRING },
                        properties: { type: Type.STRING },
                        visualDetails: { type: Type.STRING },
                        history: { type: Type.STRING },
                        visualStyle: { type: Type.STRING }
                    }
                 };
             } else if (mode === AppMode.STORY) {
                 prompt = `Generate a compelling story synopsis fitting this setting: ${context}.`;
                 schema = {
                    type: Type.OBJECT,
                    properties: {
                        synopsis: { type: Type.STRING }
                    }
                 };
             }

             if (schema) {
                 const response = await ai.models.generateContent({
                     model: 'gemini-3-flash-preview',
                     contents: prompt,
                     config: {
                         responseMimeType: "application/json",
                         responseSchema: schema
                     }
                 });
                 if (response.text) {
                     const data = JSON.parse(response.text);
                     if (mode === AppMode.CHARACTER) setCharData({ ...charData, ...data });
                     else if (mode === AppMode.ENVIRONMENT) setEnvData({ ...envData, ...data });
                     else if (mode === AppMode.PROP) setPropData({ ...propData, ...data });
                     else if (mode === AppMode.STORY) setStoryData({ ...storyData, ...data });
                     return;
                 }
             }

        } catch (e: any) {
            // Enhanced error handling for leaked/invalid keys
            const isKeyError = e.message?.includes("leaked") || e.status === 403 || e.message?.includes("API key");
            
            if (isKeyError) {
                console.warn("AI Chaos: API Key invalid or leaked. Triggering re-selection.");
                if (window.aistudio) {
                    await window.aistudio.openSelectKey();
                }
            } else {
                 console.error("AI Chaos failed, falling back to random pool", e);
            }
            // Fallthrough to random pool happens naturally after catch
        } finally {
            setIsRandomizing(false);
        }
    }

    // 3. Fallback to Random Pool
    if (mode === AppMode.CHARACTER) {
      setCharData({
        ...charData,
        name: pick(r.names),
        species: pick(r.species),
        role: pick(r.roles),
        archetype: pick(r.archetypes),
        personality: pick(r.personalityTraits),
        motivation: pick(r.motivations),
        flaws: pick(r.flaws),
        backstory: pick(r.backstories),
        visualStyle: pick(r.visualStyles),
        hairColor: pick(r.hairColors),
        eyeColor: pick(r.eyeColors),
        height: pick(r.heights),
        build: pick(r.builds),
        distinguishingFeatures: pick(r.features),
        skinTone: pick(r.skinTones),
        clothingStyle: pick(r.clothing),
        postureGait: pick(r.gaits),
        scent: pick(r.scents),
        alignment: pick(r.alignments),
        phobias: pick(r.phobias),
        hobbies: pick(r.hobbies),
        intelligence: pick(r.intelligences),
        placeOfBirth: pick(r.places),
        socialClass: pick(r.socialClasses),
        beliefs: pick(r.beliefs),
        languages: pick(r.languages),
        signatureWeapon: pick(r.weapons),
        specialAbilities: pick(r.abilities),
        combatStyle: pick(r.combatStyles),
        reputation: pick(r.reputations),
        allies: pick(r.allies),
        enemies: pick(r.enemies),
        petCompanion: pick(r.pets),
        voiceProfile: pick(r.voices),
        voiceDescription: pick(r.voiceDescriptions)
      });
    } else if (mode === AppMode.ENVIRONMENT) {
        setEnvData({
            ...envData,
            name: `The ${pick(["Ancient", "Lost", "Silent", "Forbidden", "Neon", "Crystal"])} ${pick(r.biomes).split(' ').pop()}`,
            biome: pick(r.biomes),
            timeOfDay: pick(r.times),
            weather: pick(r.weathers),
            atmosphere: pick(r.atmospheres),
            architecture: pick(r.architectures),
            landmarks: pick(r.landmarks || ["Monolith", "Ruins", "Spire", "Gateway"]),
            lighting: pick(r.lightingThemes),
            visualStyle: pick(r.visualStyles),
            history: pick(r.backstories), // Reusing general lore
            colors: pick(r.hairColors), // Abstract color re-use
            scale: pick(["Massive", "Claustrophobic", "Sprawling", "Vertical"]),
        })
    } else if (mode === AppMode.PROP) {
        setPropData({
            ...propData,
            name: `${pick(r.conditions).split(' ')[0]} ${pick(r.materials)} ${pick(r.propCategories).split(' ').pop()}`,
            category: pick(r.propCategories),
            material: pick(r.materials),
            condition: pick(r.conditions),
            visualStyle: pick(r.visualStyles),
            properties: pick(r.properties),
            origin: pick(r.places),
            size: pick(["Handheld", "Tiny", "Large", "Heavy"]),
            weight: pick(["Feather-light", "Heavy", "Unwieldy"]),
            visualDetails: pick(r.features),
            history: pick(r.backstories)
        })
    } else if (mode === AppMode.STORY) {
        setStoryData({
            ...storyData,
            synopsis: pick(r.storySynopses)
        });
    }
  };

  const getActivePrompts = () => {
      switch (mode) {
        case AppMode.CHARACTER: return [{ title: 'Narrative Profile', icon: 'fa-book-open', content: PROMPT_TEMPLATES.characterNarrative(charData) }, { title: 'Visual Description', icon: 'fa-camera', content: PROMPT_TEMPLATES.characterVisual(charData) }, { title: 'Multi-View Concept', icon: 'fa-layer-group', content: PROMPT_TEMPLATES.characterMultiView(charData) }];
        case AppMode.ENVIRONMENT: return [{ title: 'Cinematic', icon: 'fa-clapperboard', content: PROMPT_TEMPLATES.envCinematic(envData) }, { title: 'World Lore', icon: 'fa-globe', content: PROMPT_TEMPLATES.envWorldbuilding(envData) }];
        case AppMode.PROP: return [{ title: 'Technical Spec', icon: 'fa-microscope', content: PROMPT_TEMPLATES.propDescription(propData) }, { title: 'Mythic Relic', icon: 'fa-crown', content: PROMPT_TEMPLATES.propRelic(propData) }];
        default: return [];
      }
  };
  const activePrompts = getActivePrompts();
  const activePromptData = activePrompts[activeFooterTab];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200 pb-64 relative overflow-hidden">
      <header className="py-6 px-8 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3"><div className="w-10 h-10 bg-yellow-500 rounded-lg flex items-center justify-center shadow-lg shadow-yellow-500/20"><i className="fa-solid fa-bolt text-slate-900 text-xl"></i></div><h1 className="text-2xl font-bold tracking-tight text-white hidden sm:block">MythosForge</h1></div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-3 bg-slate-800 px-4 py-1.5 rounded-full border border-slate-700"><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Workspace:</span><span className="text-xs font-bold text-slate-200">{currentSessionName}</span><button onClick={handleSaveSession} title="Save to Cloud" className="text-indigo-400 hover:text-white transition-colors"><i className={`fa-solid ${user ? 'fa-cloud-arrow-up' : 'fa-floppy-disk'}`}></i></button></div>
          <div className="h-8 w-px bg-slate-800"></div>
          {user ? (
              <div ref={profileRef} className="relative">
                  <button onClick={() => setIsProfileOpen(!isProfileOpen)} className="flex items-center gap-3 group focus:outline-none">
                      <div className="text-right hidden sm:block"><div className="text-xs font-bold text-white leading-none">{user.name}</div><div className="text-[10px] text-indigo-400 uppercase tracking-widest font-black leading-none mt-1">Cloud Pro</div></div>
                      <img src={user.picture} className={`w-10 h-10 rounded-xl border border-slate-700 ring-2 transition-all ${isProfileOpen ? 'ring-indigo-500' : 'ring-transparent'}`} alt="Avatar" />
                  </button>
                  {isProfileOpen && (
                      <div className="absolute top-full right-0 mt-3 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-[100] animate-in slide-in-from-top-2 duration-200 p-2 space-y-1">
                          <button onClick={() => { setIsSettingsOpen(true); setIsProfileOpen(false); }} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-all flex items-center gap-3"><i className="fa-solid fa-key text-yellow-500"></i> API Keys</button>
                          <button onClick={() => { handleLogout(); setIsProfileOpen(false); }} className="w-full text-left px-4 py-3 text-xs font-bold text-red-400 hover:bg-red-500/10 rounded-lg transition-all flex items-center gap-3"><i className="fa-solid fa-right-from-bracket"></i> Sign Out</button>
                      </div>
                  )}
              </div>
          ) : (<button onClick={() => setIsAuthModalOpen(true)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20">Sign In</button>)}
        </div>
      </header>

      <div className="bg-slate-900/30 border-b border-slate-800 px-8 py-4 sticky top-24 z-40 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex gap-4 overflow-x-auto pb-1">
          {[AppMode.GLOBALS, AppMode.CHARACTER, AppMode.ENVIRONMENT, AppMode.PROP, AppMode.STORY, AppMode.CHRONICLE].map((m) => (
            <button key={m} onClick={() => { setMode(m); setActiveFooterTab(0); }} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-all whitespace-nowrap ${mode === m ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}><i className={`fa-solid ${m === AppMode.GLOBALS ? 'fa-sliders' : m === AppMode.CHARACTER ? 'fa-user' : m === AppMode.ENVIRONMENT ? 'fa-mountain' : m === AppMode.STORY ? 'fa-book-skull' : m === AppMode.CHRONICLE ? 'fa-scroll' : 'fa-cube'}`}></i>{m === AppMode.GLOBALS ? m : m === AppMode.STORY ? 'Story' : m === AppMode.CHRONICLE ? 'Chronicle' : `${m}s`}</button>
          ))}
        </div>
      </div>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row gap-6 items-center justify-between mb-10">
          <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            {Object.values(DetailLevel).map((l) => (<button key={l} onClick={() => setLevel(l)} className={`px-4 py-2 text-xs font-semibold rounded-md transition-all ${level === l ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>{l}</button>))}
          </div>
          <div className="flex items-center gap-3">
             <button onClick={() => setIsSessionMenuOpen(true)} className="flex items-center gap-2 px-6 py-2.5 bg-slate-800 text-slate-300 border border-slate-700 rounded-full text-sm font-semibold transition-all hover:bg-slate-700"><i className="fa-solid fa-folder-open"></i> Session Manager</button>
             <button onClick={randomize} disabled={isRandomizing} className="flex items-center gap-2 px-6 py-2.5 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded-full text-sm font-semibold transition-all group hover:bg-yellow-500/20 disabled:opacity-50">
                <i className={`fa-solid fa-dice ${isRandomizing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`}></i> 
                {isRandomizing ? 'Dreaming...' : 'Chaos Seed'}
             </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
           {mode === AppMode.GLOBALS && (
              <>
                 <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                    <SectionTitle title="Theme Engine" icon="fa-palette" />
                    <InputField label="Visual Style" value={globalData.style} onChange={(v) => setGlobalData({...globalData, style: v})} placeholder="E.g. Gritty Cyberpunk" />
                    <InputField label="Time Period" value={globalData.timePeriod} onChange={(v) => setGlobalData({...globalData, timePeriod: v})} />
                    <InputField label="Genre" value={globalData.genre} onChange={(v) => setGlobalData({...globalData, genre: v})} />
                 </section>
                 <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                    <SectionTitle title="Render Config" icon="fa-gear" />
                    <div className="grid grid-cols-2 gap-3">
                       <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-400">Aspect Ratio</label><select value={globalData.aspectRatio} onChange={(e) => setGlobalData({...globalData, aspectRatio: e.target.value as any})} className="bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm text-slate-200 outline-none"><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:3">4:3</option></select></div>
                       <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-400">Quality</label><select value={globalData.imageQuality} onChange={(e) => setGlobalData({...globalData, imageQuality: e.target.value as any})} className="bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm text-slate-200 outline-none"><option value="1K">1K</option><option value="2K">2K</option></select></div>
                    </div>
                 </section>
              </>
           )}

           {mode === AppMode.STORY && (
              <>
                {/* Story Context Board */}
                <div className="col-span-full mb-6">
                    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
                         <SectionTitle title="Story Context Board" icon="fa-users-viewfinder" />
                         {savedElements.length === 0 ? (
                             <div className="text-center py-6 text-slate-600 text-xs italic border-2 border-dashed border-slate-800 rounded-xl">No active assets in the registry. Save Characters, Props, or Environments to use them here.</div>
                         ) : (
                             <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                                 {savedElements.map(el => (
                                     <div key={el.id} className="min-w-[160px] w-[160px] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-lg group">
                                         <div className="h-24 w-full bg-slate-900 overflow-hidden relative">
                                            <img src={el.imageUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt={el.name} />
                                            <div className="absolute top-1 right-1 bg-slate-950/80 px-1.5 py-0.5 rounded text-[8px] font-black uppercase text-white">{el.type}</div>
                                         </div>
                                         <div className="p-3">
                                             <div className="font-bold text-xs text-white truncate">{el.name}</div>
                                             <div className="text-[10px] text-slate-500 line-clamp-2 leading-tight mt-1 h-8">{el.description}</div>
                                         </div>
                                     </div>
                                 ))}
                             </div>
                         )}
                    </div>
                </div>

                 <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4 col-span-1 lg:col-span-2">
                    <SectionTitle title="Story Studio" icon="fa-pen-nib" />
                    <InputField label="Synopsis" value={storyData.synopsis} onChange={(v) => setStoryData({...storyData, synopsis: v})} isTextArea />
                    <button onClick={() => sendToAI(storyData.synopsis, true)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold text-white transition-all shadow-lg shadow-indigo-600/20">Generate Narrative</button>
                    <InputField label="Full Story" value={storyData.fullStory} onChange={(v) => setStoryData({...storyData, fullStory: v})} isTextArea rows={12} />
                    
                    <div className="flex justify-end">
                       <button onClick={analyzeStory} disabled={!storyData.fullStory} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-bold transition-all border border-slate-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                          <i className="fa-solid fa-scissors"></i> Break into Scenes
                       </button>
                    </div>
                    {storyData.storyScenes.length > 0 && (
                       <div className="space-y-2 mt-2">
                          <label className="text-xs font-bold text-slate-500 uppercase">Detected Scenes</label>
                          <div className="grid gap-2">
                             {storyData.storyScenes.map((scene, idx) => (
                                <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${storyboardScene === scene ? 'bg-yellow-500/10 border-yellow-500' : 'bg-slate-800 border-slate-700 hover:border-slate-500'}`}>
                                   <div className="flex-1 cursor-pointer" onClick={() => setStoryboardScene(scene)}>
                                      <div className="font-bold mb-1 text-[10px] opacity-50 uppercase text-slate-400">Scene {idx + 1}</div>
                                      <div className={`text-xs leading-relaxed ${storyboardScene === scene ? 'text-yellow-500' : 'text-slate-300'}`}>{scene}</div>
                                   </div>
                                   <button onClick={() => generateImage(scene, { isStoryboard: true })} className="shrink-0 px-3 py-1.5 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white border border-indigo-500/30 rounded text-[10px] font-black uppercase tracking-wide flex flex-col items-center gap-1 transition-all">
                                      <i className="fa-solid fa-table-cells-large text-sm"></i>
                                      Grid (2x2)
                                   </button>
                                </div>
                             ))}
                          </div>
                       </div>
                    )}
                 </section>

                 <div className="space-y-4">
                    <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                        <SectionTitle title="Storyboard Studio" icon="fa-clapperboard" />
                        <InputField label="Scene Description" value={storyboardScene} onChange={setStoryboardScene} isTextArea placeholder="Describe the scene layout..." />
                        <div className="flex flex-col gap-3">
                            <button onClick={() => generateImage(storyboardScene, { isStoryboard: true })} className="w-full py-3 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 hover:bg-yellow-500/20 rounded-lg font-bold transition-all flex items-center justify-center gap-2">
                                <i className="fa-solid fa-table-cells-large"></i>Generate 4-Panel Layout
                            </button>
                            <button onClick={() => generateImage(storyboardScene, { isStoryboard: false })} className="w-full py-3 bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg font-bold transition-all flex items-center justify-center gap-2">
                                <i className="fa-solid fa-image"></i>Generate Cinematic Still
                            </button>
                        </div>
                    </section>
                    <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4 h-fit">
                        <SectionTitle title="Registry" icon="fa-box-archive" />
                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                           {savedElements.length === 0 ? <div className="text-center py-8 text-slate-600 italic text-xs">Vault is empty.</div> : savedElements.map((el) => (
                             <div key={el.id} className="flex gap-3 bg-slate-950 p-2 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors">
                                 <div className="w-12 h-12 rounded bg-slate-800 overflow-hidden shrink-0"><img src={el.imageUrl} alt={el.name} className="w-full h-full object-cover" /></div>
                                 <div className="flex-1 min-w-0"><h4 className="font-bold text-xs truncate text-slate-300">{el.name}</h4><p className="text-[10px] text-slate-500 uppercase font-black">{el.type}</p></div>
                                 <button onClick={() => setSavedElements(prev => prev.filter(x => x.id !== el.id))} className="text-slate-600 hover:text-red-500 px-2"><i className="fa-solid fa-trash"></i></button>
                             </div>
                           ))}
                        </div>
                    </section>
                 </div>
              </>
           )}

           {mode === AppMode.CHRONICLE && (
              <div className="col-span-full space-y-12 max-w-4xl mx-auto pb-32">
                 <div className="text-center space-y-4 py-10 border-b border-slate-800">
                    <h1 className="text-5xl font-black text-white tracking-tight">{currentSessionName}</h1>
                    <div className="flex flex-wrap justify-center gap-4 text-xs text-yellow-500 font-bold uppercase tracking-widest">
                       <span>{globalData.genre}</span>
                       <span className="text-slate-700">•</span>
                       <span>{globalData.timePeriod}</span>
                       <span className="text-slate-700">•</span>
                       <span>{globalData.style}</span>
                    </div>
                 </div>

                 {storyData.fullStory ? (
                   <section className="prose prose-invert prose-lg max-w-none">
                     <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3"><i className="fa-solid fa-book-open text-yellow-500"></i> The Narrative</h2>
                     <div className="bg-slate-900/40 p-8 rounded-2xl border border-slate-800 leading-relaxed text-slate-300 whitespace-pre-wrap font-serif text-lg shadow-xl shadow-black/20">{storyData.fullStory}</div>
                   </section>
                 ) : (
                    <div className="text-center py-10 text-slate-600 italic border-2 border-dashed border-slate-800 rounded-xl">The story has not yet been written. Visit the Story Studio to generate the narrative.</div>
                 )}

                 {characterLibrary.length > 0 && (
                    <section>
                       <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2 flex items-center gap-3"><i className="fa-solid fa-users text-indigo-500"></i> Dramatis Personae</h2>
                       <div className="grid gap-6">
                          {characterLibrary.map(char => (
                             <div key={char.id} className="flex flex-col md:flex-row gap-6 bg-slate-900/40 p-6 rounded-2xl border border-slate-800/50 hover:border-slate-700 transition-colors">
                                {char.customImage && (<div className="w-full md:w-48 h-64 shrink-0 rounded-xl overflow-hidden shadow-lg border border-slate-700 bg-slate-950"><img src={char.customImage} className="w-full h-full object-cover" alt={char.name} /></div>)}
                                <div className="flex-1 space-y-3">
                                    <div><h3 className="text-xl font-bold text-white">{char.name}</h3><p className="text-indigo-400 text-xs font-black uppercase tracking-widest">{char.species} • {char.role}</p></div>
                                    <p className="text-slate-300 text-sm leading-relaxed italic">"{char.personality}"</p>
                                    <div className="grid grid-cols-2 gap-4 text-xs text-slate-400 mt-4 bg-slate-950/30 p-4 rounded-lg">
                                        <div><strong className="text-slate-500 block uppercase text-[10px] mb-1">Archetype</strong> {char.archetype}</div>
                                        <div><strong className="text-slate-500 block uppercase text-[10px] mb-1">Motivation</strong> {char.motivation}</div>
                                        <div className="col-span-2"><strong className="text-slate-500 block uppercase text-[10px] mb-1">Backstory</strong> {char.backstory}</div>
                                    </div>
                                </div>
                             </div>
                          ))}
                       </div>
                    </section>
                 )}

                 {environmentLibrary.length > 0 && (
                    <section>
                       <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2 flex items-center gap-3"><i className="fa-solid fa-map-location-dot text-emerald-500"></i> Key Locations</h2>
                       <div className="grid gap-6 md:grid-cols-2">
                          {environmentLibrary.map(env => (
                             <div key={env.id} className="group bg-slate-900/40 rounded-2xl border border-slate-800/50 overflow-hidden hover:border-slate-700 transition-colors">
                                {env.customImage && (<div className="h-48 w-full bg-slate-950 overflow-hidden"><img src={env.customImage} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt={env.name} /></div>)}
                                <div className="p-6 space-y-3">
                                    <div><h3 className="text-lg font-bold text-white">{env.name}</h3><p className="text-emerald-500 text-xs font-black uppercase tracking-widest">{env.biome} • {env.timeOfDay}</p></div>
                                    <p className="text-slate-400 text-xs leading-relaxed">{env.atmosphere} atmosphere. {env.architecture} style.</p>
                                    {env.history && <p className="text-slate-500 text-xs italic mt-2 border-t border-slate-800/50 pt-2">{env.history}</p>}
                                </div>
                             </div>
                          ))}
                       </div>
                    </section>
                 )}

                 {propLibrary.length > 0 && (
                    <section>
                       <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2 flex items-center gap-3"><i className="fa-solid fa-gem text-pink-500"></i> Artifacts & Items</h2>
                       <div className="grid gap-4 md:grid-cols-3">
                          {propLibrary.map(prop => (
                             <div key={prop.id} className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/50 hover:border-slate-700 transition-colors flex flex-col gap-3">
                                {prop.customImage && (<div className="aspect-square w-full rounded-lg overflow-hidden bg-slate-950 border border-slate-800"><img src={prop.customImage} className="w-full h-full object-cover" alt={prop.name} /></div>)}
                                <div><h3 className="text-sm font-bold text-white">{prop.name}</h3><p className="text-pink-500 text-[10px] font-black uppercase tracking-widest">{prop.category}</p></div>
                                <p className="text-slate-400 text-xs line-clamp-3">{prop.properties}</p>
                             </div>
                          ))}
                       </div>
                    </section>
                 )}

                 {savedElements.length > 0 && (
                    <section>
                       <h2 className="text-2xl font-bold text-white mb-6 border-b border-slate-800 pb-2 flex items-center gap-3"><i className="fa-solid fa-images text-blue-500"></i> Visual Archive</h2>
                       <div className="columns-2 md:columns-3 gap-4 space-y-4">
                          {savedElements.map(el => (
                             <div key={el.id} className="break-inside-avoid bg-slate-900/40 rounded-xl border border-slate-800 overflow-hidden group">
                                <img src={el.imageUrl} className="w-full h-auto" alt={el.name} />
                                <div className="p-3 bg-slate-950/80">
                                   <div className="text-xs font-bold text-white truncate">{el.name}</div>
                                   <div className="text-[10px] text-slate-500 uppercase font-black">{el.type}</div>
                                </div>
                             </div>
                          ))}
                       </div>
                    </section>
                 )}
              </div>
           )}

           {mode === AppMode.CHARACTER && (
              <>
                <div className="col-span-full"><AssetManager label="Character" library={characterLibrary} currentId={charData.id} onLoad={loadCharacter} onSave={saveCharacter} onNew={newCharacter} onDelete={deleteCharacter} /></div>
                
                {/* Identity */}
                <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <VisualReference imageData={charData.customImage} onUpload={(img) => setCharData({...charData, customImage: img})} onClear={() => setCharData({...charData, customImage: undefined})} />
                  <SectionTitle title="Identity" icon="fa-dna" />
                  <InputField label="Name" value={charData.name} onChange={v => setCharData({...charData, name: v})} />
                  <div className="grid grid-cols-2 gap-3">
                     <InputField label="Species" value={charData.species} onChange={v => setCharData({...charData, species: v})} />
                     {(showIntermediate || showComplex) && <InputField label="Age" value={charData.age} onChange={v => setCharData({...charData, age: v})} />}
                  </div>
                  <div className="grid grid-cols-2 gap-3"><InputField label="Role" value={charData.role} onChange={v => setCharData({...charData, role: v})} /><InputField label="Archetype" value={charData.archetype} onChange={v => setCharData({...charData, archetype: v})} /></div>
                </section>

                {/* Physicality */}
                {(showIntermediate || showComplex) && (
                   <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                      <SectionTitle title="Physicality" icon="fa-person" />
                      <div className="grid grid-cols-2 gap-3"><InputField label="Height" value={charData.height} onChange={v => setCharData({...charData, height: v})} /><InputField label="Build" value={charData.build} onChange={v => setCharData({...charData, build: v})} /></div>
                      <div className="grid grid-cols-3 gap-3"><InputField label="Skin" value={charData.skinTone} onChange={v => setCharData({...charData, skinTone: v})} /><InputField label="Hair" value={charData.hairColor} onChange={v => setCharData({...charData, hairColor: v})} /><InputField label="Eyes" value={charData.eyeColor} onChange={v => setCharData({...charData, eyeColor: v})} /></div>
                      {showComplex && (
                         <>
                            <div className="grid grid-cols-2 gap-3"><InputField label="Features" value={charData.distinguishingFeatures} onChange={v => setCharData({...charData, distinguishingFeatures: v})} /><InputField label="Tattoos" value={charData.tattoosMarkings} onChange={v => setCharData({...charData, tattoosMarkings: v})} /></div>
                            <div className="grid grid-cols-2 gap-3"><InputField label="Clothing" value={charData.clothingStyle} onChange={v => setCharData({...charData, clothingStyle: v})} /><InputField label="Posture" value={charData.postureGait} onChange={v => setCharData({...charData, postureGait: v})} /></div>
                            <InputField label="Scent" value={charData.scent} onChange={v => setCharData({...charData, scent: v})} />
                         </>
                      )}
                      <InputField label="Visual Style" value={charData.visualStyle} onChange={v => setCharData({...charData, visualStyle: v})} />
                   </section>
                )}
                
                {/* Equipment & Abilities (Complex Only) */}
                {showComplex && (
                    <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                       <SectionTitle title="Equipment & Abilities" icon="fa-shield-halved" />
                       <div className="grid grid-cols-2 gap-3"><InputField label="Weapon" value={charData.signatureWeapon} onChange={v => setCharData({...charData, signatureWeapon: v})} /><InputField label="Combat Style" value={charData.combatStyle} onChange={v => setCharData({...charData, combatStyle: v})} /></div>
                       <InputField label="Abilities" value={charData.specialAbilities} onChange={v => setCharData({...charData, specialAbilities: v})} />
                       <InputField label="Companion" value={charData.petCompanion} onChange={v => setCharData({...charData, petCompanion: v})} />
                    </section>
                )}

                {/* Psyche & Lore */}
                <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <SectionTitle title="Psyche & Lore" icon="fa-brain" />
                  <InputField label="Personality" value={charData.personality} onChange={v => setCharData({...charData, personality: v})} isTextArea />
                  {(showIntermediate || showComplex) && (
                      <div className="grid grid-cols-2 gap-3"><InputField label="Motivation" value={charData.motivation} onChange={v => setCharData({...charData, motivation: v})} /><InputField label="Flaws" value={charData.flaws} onChange={v => setCharData({...charData, flaws: v})} /></div>
                  )}
                  {showComplex && (
                     <div className="grid grid-cols-2 gap-3">
                        <InputField label="Alignment" value={charData.alignment} onChange={v => setCharData({...charData, alignment: v})} />
                        <InputField label="Intelligence" value={charData.intelligence} onChange={v => setCharData({...charData, intelligence: v})} />
                        <InputField label="Phobias" value={charData.phobias} onChange={v => setCharData({...charData, phobias: v})} />
                        <InputField label="Hobbies" value={charData.hobbies} onChange={v => setCharData({...charData, hobbies: v})} />
                        <InputField label="Beliefs" value={charData.beliefs} onChange={v => setCharData({...charData, beliefs: v})} />
                     </div>
                  )}
                  
                  {(showIntermediate || showComplex) && <InputField label="Backstory" value={charData.backstory} onChange={v => setCharData({...charData, backstory: v})} isTextArea />}
                  
                  {showComplex && (
                     <>
                        <div className="grid grid-cols-2 gap-3"><InputField label="Origin" value={charData.placeOfBirth} onChange={v => setCharData({...charData, placeOfBirth: v})} /><InputField label="Social Class" value={charData.socialClass} onChange={v => setCharData({...charData, socialClass: v})} /></div>
                        <div className="grid grid-cols-2 gap-3"><InputField label="Languages" value={charData.languages} onChange={v => setCharData({...charData, languages: v})} /><InputField label="Reputation" value={charData.reputation} onChange={v => setCharData({...charData, reputation: v})} /></div>
                        <div className="grid grid-cols-2 gap-3"><InputField label="Allies" value={charData.allies} onChange={v => setCharData({...charData, allies: v})} /><InputField label="Enemies" value={charData.enemies} onChange={v => setCharData({...charData, enemies: v})} /></div>
                        <InputField label="Secrets" value={charData.secrets} onChange={v => setCharData({...charData, secrets: v})} />
                     </>
                  )}
                </section>
                
                {/* Voice (Complex Only) */}
                {showComplex && (
                   <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                       <SectionTitle title="Voice Settings" icon="fa-microphone-lines" />
                       <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5 w-full"><label className="text-xs font-medium text-slate-400">Provider</label><select value={charData.voiceProvider} onChange={e => setCharData({...charData, voiceProvider: e.target.value as any})} className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-yellow-500/30"><option value="Gemini">Gemini</option><option value="ElevenLabs">ElevenLabs</option></select></div>
                          {charData.voiceProvider === 'Gemini' ? (<div className="flex flex-col gap-1.5 w-full"><label className="text-xs font-medium text-slate-400">Profile</label><select value={charData.voiceProfile} onChange={e => setCharData({...charData, voiceProfile: e.target.value})} className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-yellow-500/30"><option value="Puck">Puck</option><option value="Charon">Charon</option><option value="Kore">Kore</option><option value="Fenrir">Fenrir</option><option value="Zephyr">Zephyr</option></select></div>) : (<InputField label="Voice ID" value={charData.elevenLabsVoiceId || ''} onChange={v => setCharData({...charData, elevenLabsVoiceId: v})} />)}
                       </div>
                       <InputField label="Description" value={charData.voiceDescription} onChange={v => setCharData({...charData, voiceDescription: v})} />
                   </section>
                )}
              </>
           )}

           {mode === AppMode.ENVIRONMENT && (
              <>
                 <div className="col-span-full"><AssetManager label="Environment" library={environmentLibrary} currentId={envData.id} onLoad={loadEnvironment} onSave={saveEnvironment} onNew={newEnvironment} onDelete={deleteEnvironment} /></div>
                 <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                    <VisualReference imageData={envData.customImage} onUpload={(img) => setEnvData({...envData, customImage: img})} onClear={() => setEnvData({...envData, customImage: undefined})} />
                    <SectionTitle title="Locale" icon="fa-mountain-city" />
                    <InputField label="Name" value={envData.name} onChange={v => setEnvData({...envData, name: v})} />
                    <div className="grid grid-cols-2 gap-3"><InputField label="Biome" value={envData.biome} onChange={v => setEnvData({...envData, biome: v})} /><InputField label="Time" value={envData.timeOfDay} onChange={v => setEnvData({...envData, timeOfDay: v})} /></div>
                    {(showIntermediate || showComplex) && <InputField label="Weather" value={envData.weather} onChange={v => setEnvData({...envData, weather: v})} />}
                 </section>
                 {(showIntermediate || showComplex) && (
                    <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                       <SectionTitle title="Ambience" icon="fa-cloud-sun" />
                       <InputField label="Atmosphere" value={envData.atmosphere} onChange={v => setEnvData({...envData, atmosphere: v})} />
                       <div className="grid grid-cols-2 gap-3"><InputField label="Architecture" value={envData.architecture} onChange={v => setEnvData({...envData, architecture: v})} /><InputField label="Landmarks" value={envData.landmarks} onChange={v => setEnvData({...envData, landmarks: v})} /></div>
                       <InputField label="Lighting" value={envData.lighting} onChange={v => setEnvData({...envData, lighting: v})} />
                       {showComplex && (
                          <>
                             <div className="grid grid-cols-2 gap-3"><InputField label="Scale" value={envData.scale} onChange={v => setEnvData({...envData, scale: v})} /><InputField label="Colors" value={envData.colors} onChange={v => setEnvData({...envData, colors: v})} /></div>
                             <InputField label="Visual Style" value={envData.visualStyle} onChange={v => setEnvData({...envData, visualStyle: v})} />
                             <InputField label="History" value={envData.history} onChange={v => setEnvData({...envData, history: v})} isTextArea />
                          </>
                       )}
                    </section>
                 )}
              </>
           )}

           {mode === AppMode.PROP && (
              <>
                 <div className="col-span-full"><AssetManager label="Prop" library={propLibrary} currentId={propData.id} onLoad={loadProp} onSave={saveProp} onNew={newProp} onDelete={deleteProp} /></div>
                 <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                    <VisualReference imageData={propData.customImage} onUpload={(img) => setPropData({...propData, customImage: img})} onClear={() => setPropData({...propData, customImage: undefined})} />
                    <SectionTitle title="Item" icon="fa-box" />
                    <InputField label="Name" value={propData.name} onChange={v => setPropData({...propData, name: v})} />
                    <div className="grid grid-cols-2 gap-3"><InputField label="Category" value={propData.category} onChange={v => setPropData({...propData, category: v})} /><InputField label="Material" value={propData.material} onChange={v => setPropData({...propData, material: v})} /></div>
                 </section>
                 {(showIntermediate || showComplex) && (
                    <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                       <SectionTitle title="Specs" icon="fa-ruler-combined" />
                       <div className="grid grid-cols-3 gap-3"><InputField label="Size" value={propData.size} onChange={v => setPropData({...propData, size: v})} /><InputField label="Weight" value={propData.weight} onChange={v => setPropData({...propData, weight: v})} /><InputField label="Condition" value={propData.condition} onChange={v => setPropData({...propData, condition: v})} /></div>
                       <InputField label="Properties" value={propData.properties} onChange={v => setPropData({...propData, properties: v})} isTextArea />
                       {showComplex && (
                          <>
                             <div className="grid grid-cols-2 gap-3"><InputField label="Origin" value={propData.origin} onChange={v => setPropData({...propData, origin: v})} /><InputField label="Visual Style" value={propData.visualStyle} onChange={v => setPropData({...propData, visualStyle: v})} /></div>
                             <InputField label="Visual Details" value={propData.visualDetails} onChange={v => setPropData({...propData, visualDetails: v})} isTextArea />
                             <InputField label="History" value={propData.history} onChange={v => setPropData({...propData, history: v})} isTextArea />
                          </>
                       )}
                    </section>
                 )}
              </>
           )}
        </div>
      </main>

      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onLogin={handleLogin} />
      <SessionModal isOpen={isSessionMenuOpen} onClose={() => setIsSessionMenuOpen(false)} sessions={sessions} currentName={currentSessionName} onRename={setCurrentSessionName} onSave={handleSaveSession} onLoad={handleLoadSession} onDelete={handleDeleteSession} onNew={handleNewSession} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} apiKey={globalData.customApiKey || ''} elevenLabsKey={globalData.elevenLabsApiKey || ''} onUpdate={handleUpdateKeys} />

      {/* Footer / Prompt View */}
      {mode !== AppMode.GLOBALS && mode !== AppMode.STORY && mode !== AppMode.CHRONICLE && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-yellow-500/20 shadow-2xl z-40 p-0 flex flex-col h-64">
           <div className="flex bg-slate-950/80 border-b border-slate-800">
            {activePrompts.map((p, idx) => (
              <button key={idx} onClick={() => setActiveFooterTab(idx)} className={`flex-1 py-3 text-xs font-bold uppercase transition-all flex items-center justify-center gap-2 ${activeFooterTab === idx ? 'text-yellow-500 bg-slate-900 border-t-2 border-yellow-500' : 'text-slate-500 hover:bg-slate-800'}`}>
                <i className={`fa-solid ${p.icon}`}></i><span>{p.title}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 p-6 overflow-hidden flex flex-col">
             <div className="flex justify-between items-center mb-3">
                 <h3 className="text-yellow-500 font-bold text-sm uppercase flex items-center gap-2"><i className={`fa-solid ${activePromptData?.icon}`}></i>{activePromptData?.title}</h3>
                 <div className="flex gap-2">
                    <button onClick={() => generateImage(activePromptData?.content || "", { isMultiView: activePromptData?.title.includes("Multi-View") })} className="px-4 py-1.5 bg-yellow-500/10 text-yellow-500 rounded text-xs font-black uppercase transition-all border border-yellow-500/30 flex items-center gap-2"><i className="fa-solid fa-image"></i>Visualize</button>
                    {mode === AppMode.CHARACTER && <button onClick={() => generateVoice(activePromptData?.content.substring(0, 200) || "")} className="px-4 py-1.5 bg-pink-500/10 text-pink-500 rounded text-xs font-black uppercase transition-all border border-pink-500/30 flex items-center gap-2"><i className="fa-solid fa-microphone-lines"></i>Speak</button>}
                    <button onClick={() => copyToClipboard(activePromptData?.content || "", activeFooterTab)} className={`px-4 py-1.5 rounded text-xs font-bold uppercase transition-all ${copiedIndex === activeFooterTab ? 'bg-green-600' : 'bg-slate-800 text-slate-300'}`}>{copiedIndex === activeFooterTab ? 'Copied' : 'Copy'}</button>
                 </div>
             </div>
             <div className="flex-1 bg-slate-950 rounded-lg p-4 mono text-xs leading-relaxed text-slate-300 overflow-y-auto border border-slate-800"><pre className="whitespace-pre-wrap font-mono">{activePromptData?.content}</pre></div>
          </div>
        </div>
      )}

      {/* FAB and Chat */}
      <button onClick={() => setIsChatOpen(!isChatOpen)} className="fixed bottom-32 right-8 w-14 h-14 bg-yellow-500 hover:bg-yellow-400 text-slate-950 rounded-full shadow-2xl z-50 flex items-center justify-center transition-all border-4 border-slate-900 active:scale-90"><i className={`fa-solid ${isChatOpen ? 'fa-times' : 'fa-brain'} text-xl`}></i></button>
      <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl z-[60] transform transition-transform duration-300 flex flex-col ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50"><div className="flex items-center gap-3"><div className="w-8 h-8 bg-yellow-500 rounded flex items-center justify-center"><i className="fa-solid fa-bolt text-slate-950 text-sm"></i></div><span className="font-black text-yellow-500 uppercase tracking-tighter text-sm">Pro Studio</span></div><button onClick={() => setIsChatOpen(false)} className="text-slate-500 hover:text-white p-2 transition-colors"><i className="fa-solid fa-xmark text-xl"></i></button></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] p-4 rounded-2xl text-sm ${m.role === 'user' ? 'bg-indigo-600/20 border border-indigo-500/30 text-slate-100 rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700'}`}>
                {m.text}
                {m.image && (<div className="mt-4 flex flex-col gap-2"><div className="rounded-lg overflow-hidden border border-slate-700 shadow-2xl bg-slate-950 relative group"><img src={m.image} className="w-full h-auto" /><div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><button onClick={() => handleImageDownload(m.image!, m.isMultiView, m.isStoryboard)} className="p-3 bg-yellow-500 text-slate-950 rounded-full hover:scale-110 transition-transform"><i className="fa-solid fa-download"></i></button></div></div>
                {m.isStoryboard && (
                    <div className="grid grid-cols-4 gap-2">
                        {[1,2,3,4].map(q => (
                            <button key={q} onClick={() => handleUpscaleQuadrant(m.image!, q, m.text)} className="py-2 bg-slate-800 text-slate-300 text-[10px] font-bold uppercase rounded border border-slate-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-500 transition-colors flex flex-col items-center gap-1">
                                <i className="fa-solid fa-expand"></i> Panel {q}
                            </button>
                        ))}
                    </div>
                )}
                <button onClick={() => handleSaveElement(mode, getContextName(), m.text.substring(0, 100), m.image!)} className="w-full py-2 bg-slate-700 hover:bg-green-600 text-white text-xs font-bold rounded flex items-center justify-center gap-2 transition-colors"><i className="fa-solid fa-floppy-disk"></i>Add to Registry</button></div>)}
                {m.audioData && (<div className="mt-4 bg-slate-900 p-3 rounded-lg border border-slate-700 flex items-center gap-3"><button onClick={() => playAudio(m.audioData!)} className="w-10 h-10 rounded-full bg-pink-500 text-slate-950 flex items-center justify-center transition-transform hover:scale-105"><i className="fa-solid fa-play"></i></button><div className="flex-1 text-[10px] text-slate-400 uppercase tracking-widest font-black">Voice Output</div><button onClick={() => handleAudioDownload(m.audioData!, charData.voiceProvider === 'ElevenLabs')} className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center transition-colors hover:text-white"><i className="fa-solid fa-download"></i></button></div>)}
                {idx === chatMessages.length - 1 && isTyping && <div className="mt-2 flex items-center gap-2"><span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce"></span><span className="text-[10px] text-yellow-500/60 font-black uppercase animate-pulse">{genStatus}</span></div>}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (chatInput.trim()) sendToAI(chatInput); }} className="p-4 bg-slate-950 border-t border-slate-800">
          <div className="relative"><input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Refine chronicle..." className="w-full bg-slate-900 border border-slate-700 rounded-xl py-4 pl-5 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50 transition-all text-slate-200" /><button type="submit" disabled={isTyping || !chatInput.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-yellow-500 hover:text-yellow-400 disabled:opacity-20 transition-all"><i className="fa-solid fa-paper-plane text-lg"></i></button></div>
        </form>
      </div>
    </div>
  );
}

const InputField: React.FC<{ label: string; value: string; onChange: (value: string) => void; placeholder?: string; isTextArea?: boolean; rows?: number; type?: string; }> = ({ label, value, onChange, placeholder, isTextArea, rows = 3, type = "text" }) => (
  <div className="flex flex-col gap-1.5 w-full"><label className="text-xs font-medium text-slate-400">{label}</label>{isTextArea ? (<textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30 transition-all resize-none text-slate-200" />) : (<input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30 transition-all text-slate-200" />)}</div>
);

const SectionTitle: React.FC<{ title: string; icon: string }> = ({ title, icon }) => ( <h3 className="text-sm font-semibold text-yellow-500/80 uppercase tracking-wider mb-4 flex items-center gap-2"><i className={`fa-solid ${icon}`}></i> {title}</h3> );

const VisualReference: React.FC<{ imageData?: string; onUpload: (data: string) => void; onClear: () => void; }> = ({ imageData, onUpload, onClear }) => {
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files[0]) { const reader = new FileReader(); reader.onloadend = () => onUpload(reader.result as string); reader.readAsDataURL(e.target.files[0]); } };
  return (
    <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 mb-4">
      <div className="flex flex-col gap-3">
        {!imageData ? (<div className="relative group w-full h-24"><input type="file" accept="image/*" onChange={handleUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" /><div className="border-2 border-dashed border-slate-700 rounded-xl h-full flex flex-col items-center justify-center gap-2 text-slate-500 group-hover:border-yellow-500/50 group-hover:text-yellow-500 transition-colors bg-slate-800/50"><i className="fa-solid fa-image text-xl"></i><span className="text-[10px] font-black uppercase tracking-widest">Add Ref</span></div></div>) : (<div className="relative rounded-lg overflow-hidden border border-slate-700 group w-full aspect-video"><img src={imageData} alt="Ref" className="w-full h-full object-cover" /><button onClick={onClear} className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"><i className="fa-solid fa-xmark"></i></button></div>)}
      </div>
    </div>
  );
};

const SettingsModal: React.FC<{ isOpen: boolean; onClose: () => void; apiKey: string; elevenLabsKey: string; onUpdate: (gemini?: string, eleven?: string) => void; }> = ({ isOpen, onClose, apiKey, elevenLabsKey, onUpdate }) => {
  const [showKey, setShowKey] = useState(false); const [localGemini, setLocalGemini] = useState(apiKey); const [localEleven, setLocalEleven] = useState(elevenLabsKey);
  const modalRef = useRef<HTMLDivElement>(null); useClickOutside(modalRef, onClose);
  useEffect(() => { setLocalGemini(apiKey); setLocalEleven(elevenLabsKey); }, [apiKey, elevenLabsKey]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div ref={modalRef} className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center"><h2 className="text-xl font-bold text-white">Multiversal API Keys</h2><button onClick={onClose} className="text-slate-500 hover:text-white"><i className="fa-solid fa-xmark"></i></button></div>
        <div className="p-6 space-y-4">
           <div className="relative"><InputField label="Google Gemini API Key" type={showKey ? "text" : "password"} value={localGemini} onChange={setLocalGemini} /><button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-8 text-slate-500 hover:text-white"><i className={`fa-solid ${showKey ? 'fa-eye-slash' : 'fa-eye'}`}></i></button></div>
           <div className="relative"><InputField label="ElevenLabs API Key" type={showKey ? "text" : "password"} value={localEleven} onChange={setLocalEleven} /><button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-8 text-slate-500 hover:text-white"><i className={`fa-solid ${showKey ? 'fa-eye-slash' : 'fa-eye'}`}></i></button></div>
           <button onClick={() => { onUpdate(localGemini, localEleven); onClose(); }} className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-lg mt-2 shadow-lg shadow-indigo-600/20">Secure Credentials</button>
           <p className="text-[10px] text-slate-500 italic text-center">Keys are saved to your profile and encrypted in transit.</p>
        </div>
      </div>
    </div>
  );
};

const AssetManager: React.FC<{ library: any[]; currentId?: string; onLoad: (id: string) => void; onSave: () => void; onNew: () => void; onDelete: () => void; label: string; }> = ({ library, currentId, onLoad, onSave, onNew, onDelete, label }) => (
  <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row gap-4 items-center mb-6 shadow-lg">
    <div className="flex-1 w-full flex flex-col gap-1"><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label} Stack</label><select value={currentId || ""} onChange={(e) => onLoad(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-yellow-500/30"><option value="">-- Workspace Draft --</option>{library.map((item: any) => (<option key={item.id} value={item.id}>{item.name || "Untitled"}</option>))}</select></div>
    <div className="flex gap-2 w-full sm:w-auto pt-5"><button onClick={onNew} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg transition-colors border border-slate-700" title="New Draft"><i className="fa-solid fa-plus"></i></button><button onClick={onSave} className="flex-1 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"><i className="fa-solid fa-floppy-disk"></i>Save Stack</button>{currentId && <button onClick={onDelete} className="p-2 text-slate-600 hover:text-red-500 transition-colors"><i className="fa-solid fa-trash"></i></button>}</div>
  </div>
);
