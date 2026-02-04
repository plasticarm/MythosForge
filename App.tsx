
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { DetailLevel, AppMode, CharacterData, EnvironmentData, PropData, GlobalData, SavedElement, StoryData, Session, Message } from './types';
import { RANDOM_POOL, PROMPT_TEMPLATES } from './constants';

// --- Audio Utilities ---
const decode = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

const getWavBytes = (pcmData: Uint8Array, sampleRate: number): Uint8Array => {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const channels = 1;
  const bitDepth = 16;
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitDepth / 8), true);
  view.setUint16(32, channels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true);
  const wavFile = new Uint8Array(header.byteLength + pcmData.length);
  wavFile.set(new Uint8Array(header), 0);
  wavFile.set(pcmData, 44);
  return wavFile;
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

const downloadAudio = (base64Data: string, charName: string, contentText: string, isElevenLabs = false) => {
  try {
    const bytes = decode(base64Data);
    let blob;
    if (isElevenLabs) {
        blob = new Blob([bytes], { type: 'audio/mpeg' });
    } else {
        const wavBytes = getWavBytes(bytes, 24000); 
        blob = new Blob([wavBytes], { type: 'audio/wav' });
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (charName || 'Character').trim().replace(/[^a-z0-9]/gi, '_');
    const safeText = contentText.replace(/["']/g, '').trim().substring(0, 20).replace(/[^a-z0-9]/gi, '_');
    link.href = url;
    link.download = `${safeName}_${safeText}.${isElevenLabs ? 'mp3' : 'wav'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download error:", e);
  }
};

// --- Modals ---

const SessionModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  sessions: Session[];
  currentName: string;
  onRename: (name: string) => void;
  onSave: () => void;
  onLoad: (session: Session) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}> = ({ isOpen, onClose, sessions, currentName, onRename, onSave, onLoad, onDelete, onNew }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[70] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 max-h-[90vh]">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-indigo-900/10">
           <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white">
                <i className="fa-solid fa-folder-tree"></i>
              </div>
              <h2 className="text-xl font-bold text-white">Session Manager</h2>
           </div>
           <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
             <i className="fa-solid fa-xmark text-xl"></i>
           </button>
        </div>

        <div className="p-6 space-y-8 overflow-y-auto">
          {/* Current Session Section */}
          <div className="space-y-4">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Active Session
            </h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <input 
                type="text" 
                value={currentName}
                onChange={(e) => onRename(e.target.value)}
                placeholder="Session Name..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-bold"
              />
              <button 
                onClick={onSave}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-floppy-disk"></i>
                Save Current
              </button>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Saved Chronicles</h3>
              <button onClick={onNew} className="text-xs font-bold text-indigo-400 hover:text-white transition-colors flex items-center gap-2">
                <i className="fa-solid fa-file-circle-plus"></i>
                New Workspace
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {sessions.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed border-slate-800 rounded-2xl text-slate-600 italic">
                  No saved sessions found in local storage.
                </div>
              ) : (
                sessions.sort((a,b) => b.lastModified - a.lastModified).map(s => (
                  <div key={s.id} className="group flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 rounded-xl transition-all">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-slate-200 truncate">{s.name}</h4>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">
                        Last Modified: {new Date(s.lastModified).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => onLoad(s)}
                        className="px-3 py-1.5 bg-slate-700 hover:bg-indigo-600 text-white text-xs font-bold rounded-lg transition-all"
                      >
                        Load
                      </button>
                      <button 
                        onClick={() => onDelete(s.id)}
                        className="p-1.5 text-slate-500 hover:text-red-500 transition-all"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Chronicle View Component ---
const ChronicleView: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  session: {
    name: string;
    charLibrary: CharacterData[];
    envLibrary: EnvironmentData[];
    propLibrary: PropData[];
    story: StoryData;
    globals: GlobalData;
  }
}> = ({ isOpen, onClose, session }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950 z-[100] overflow-y-auto animate-in fade-in duration-500">
      <nav className="sticky top-0 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-8 py-4 flex justify-between items-center z-50">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-yellow-500 rounded flex items-center justify-center text-slate-950">
            <i className="fa-solid fa-book-open"></i>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">{session.name}</h2>
        </div>
        <button 
          onClick={onClose}
          className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full font-bold text-xs uppercase tracking-widest transition-all border border-slate-700"
        >
          <i className="fa-solid fa-arrow-left mr-2"></i> Return to Forge
        </button>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-20 space-y-32">
        <header className="text-center space-y-6">
          <div className="text-yellow-500 text-xs font-black uppercase tracking-[0.4em]">The Chronicle of</div>
          <h1 className="text-6xl md:text-8xl font-black text-white leading-tight">{session.name}</h1>
          <div className="w-24 h-1 bg-yellow-500 mx-auto rounded-full"></div>
          {session.story.synopsis && (
            <p className="text-xl text-slate-400 font-medium italic max-w-2xl mx-auto leading-relaxed">
              "{session.story.synopsis}"
            </p>
          )}
        </header>

        {session.story.fullStory && (
          <section className="space-y-12">
            <h3 className="text-3xl font-bold text-white flex items-center gap-4">
              <span className="w-12 h-px bg-slate-800"></span>
              The Narrative
            </h3>
            <div className="prose prose-invert prose-lg max-w-none text-slate-300 leading-loose whitespace-pre-wrap font-serif">
              {session.story.fullStory}
            </div>
          </section>
        )}

        {session.charLibrary.length > 0 && (
          <section className="space-y-16">
            <h3 className="text-3xl font-bold text-white flex items-center gap-4">
              <span className="w-12 h-px bg-slate-800"></span>
              Dramatis Personae
            </h3>
            <div className="space-y-24">
              {session.charLibrary.map((char, idx) => (
                <div key={char.id} className={`flex flex-col ${idx % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'} gap-12 items-start`}>
                  <div className="w-full md:w-1/2 aspect-[3/4] rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl">
                    <img 
                      src={char.customImage || 'https://via.placeholder.com/600x800?text=Awaiting+Manifestation'} 
                      alt={char.name} 
                      className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
                    />
                  </div>
                  <div className="w-full md:w-1/2 space-y-6">
                    <div>
                      <h4 className="text-4xl font-black text-white mb-1">{char.name}</h4>
                      <div className="text-yellow-500 font-bold uppercase tracking-widest text-xs">
                        {char.species} • {char.role}
                      </div>
                    </div>
                    <div className="space-y-4 text-slate-400 leading-relaxed">
                      <p><strong className="text-slate-200">Essence:</strong> {char.personality}</p>
                      <p><strong className="text-slate-200">Drive:</strong> {char.motivation}</p>
                      <p><strong className="text-slate-200">Background:</strong> {char.backstory}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {session.envLibrary.length > 0 && (
          <section className="space-y-16">
            <h3 className="text-3xl font-bold text-white flex items-center gap-4">
              <span className="w-12 h-px bg-slate-800"></span>
              The Domain
            </h3>
            <div className="space-y-24">
              {session.envLibrary.map((env, idx) => (
                <div key={env.id} className="space-y-8">
                  <div className="aspect-video w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl group">
                    <img 
                      src={env.customImage || 'https://via.placeholder.com/1200x675?text=Terra+Incognita'} 
                      alt={env.name} 
                      className="w-full h-full object-cover scale-105 group-hover:scale-100 transition-all duration-[2000ms]"
                    />
                  </div>
                  <div className="grid md:grid-cols-3 gap-8">
                    <div className="md:col-span-1">
                      <h4 className="text-3xl font-black text-white">{env.name}</h4>
                      <div className="text-indigo-400 font-bold uppercase tracking-widest text-xs mt-1">{env.biome}</div>
                    </div>
                    <div className="md:col-span-2 space-y-4 text-slate-400 leading-relaxed">
                      <p><strong className="text-slate-200 italic">{env.atmosphere}</strong> — {env.history}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {session.propLibrary.length > 0 && (
          <section className="space-y-16">
            <h3 className="text-3xl font-bold text-white flex items-center gap-4">
              <span className="w-12 h-px bg-slate-800"></span>
              The Vault
            </h3>
            <div className="grid sm:grid-cols-2 gap-8">
              {session.propLibrary.map((prop) => (
                <div key={prop.id} className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 space-y-6">
                  <div className="w-full aspect-square rounded-2xl overflow-hidden bg-slate-950 border border-slate-800">
                    <img 
                      src={prop.customImage || 'https://via.placeholder.com/400x400?text=Undeclared+Relic'} 
                      alt={prop.name} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-2xl font-black text-white">{prop.name}</h4>
                    <div className="text-pink-500 font-bold uppercase tracking-widest text-[10px]">{prop.category}</div>
                  </div>
                  <p className="text-slate-400 text-sm leading-relaxed">{prop.properties}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="pt-32 pb-20 text-center space-y-4 opacity-50">
          <div className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-500">End of Record</div>
          <div className="w-12 h-px bg-slate-800 mx-auto"></div>
        </footer>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.GLOBALS);
  const [level, setLevel] = useState<DetailLevel>(DetailLevel.SIMPLE);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [activeFooterTab, setActiveFooterTab] = useState(0);

  // --- Session State ---
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChronicleOpen, setIsChronicleOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionName, setCurrentSessionName] = useState('New Chronicle');

  // --- AI State ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [activeRefImage, setActiveRefImage] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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

  const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  const checkKey = async () => {
    if ((window.aistudio && await window.aistudio.hasSelectedApiKey()) || (globalData.customApiKey && globalData.customApiKey.length > 10)) {
      setHasKey(true);
    } else { setHasKey(false); }
  };

  useEffect(() => { scrollToBottom(); checkKey(); }, [chatMessages, isTyping, globalData.customApiKey]);
  useEffect(() => {
    const saved = localStorage.getItem('mythos_forge_sessions');
    if (saved) { try { setSessions(JSON.parse(saved)); } catch (e) { console.error(e); } }
  }, []);

  const saveSessionsToStorage = (updatedSessions: Session[]) => {
    localStorage.setItem('mythos_forge_sessions', JSON.stringify(updatedSessions));
    setSessions(updatedSessions);
  };

  const handleSaveSession = () => {
    const sessionData: Session = {
      id: Date.now().toString(),
      name: currentSessionName || 'Untitled Session',
      lastModified: Date.now(),
      data: {
        mode, globalData, charData, characterLibrary, envData, environmentLibrary, propData, propLibrary, storyData, savedElements, chatMessages
      }
    };
    const existingIndex = sessions.findIndex(s => s.name === sessionData.name);
    let newSessions;
    if (existingIndex >= 0) {
       newSessions = [...sessions];
       newSessions[existingIndex] = sessionData;
    } else { newSessions = [...sessions, sessionData]; }
    saveSessionsToStorage(newSessions);
    alert('Progress Anchored in Reality!');
  };

  const handleLoadSession = (session: Session) => {
    if (window.confirm(`Manifest chronicle "${session.name}"?`)) {
      setMode(session.data.mode);
      setGlobalData(session.data.globalData);
      setCharData(session.data.charData);
      setCharacterLibrary(session.data.characterLibrary || []);
      setEnvData(session.data.envData);
      setEnvironmentLibrary(session.data.environmentLibrary || []);
      setPropData(session.data.propData);
      setPropLibrary(session.data.propLibrary || []);
      setStoryData(session.data.storyData);
      setSavedElements(session.data.savedElements);
      setChatMessages(session.data.chatMessages);
      setCurrentSessionName(session.name);
      setIsSessionMenuOpen(false);
    }
  };

  const handleDeleteSession = (id: string) => {
    if (window.confirm("Purge this chronicle from memory?")) {
      const newSessions = sessions.filter(s => s.id !== id);
      saveSessionsToStorage(newSessions);
    }
  };

  const handleNewSession = () => {
     if (window.confirm("Begin a fresh chronicle?")) {
         setGlobalData(initialGlobalData);
         setCharData(initialCharData);
         setCharacterLibrary([]);
         setEnvData(initialEnvData);
         setEnvironmentLibrary([]);
         setPropData(initialPropData);
         setPropLibrary([]);
         setStoryData({ synopsis: '', fullStory: '', storyScenes: [] });
         setSavedElements([]);
         setChatMessages([]);
         setCurrentSessionName('New Chronicle');
         setMode(AppMode.GLOBALS);
         setIsSessionMenuOpen(false);
     }
  };

  const handleOpenKey = async () => {
    if (window.aistudio) { await window.aistudio.openSelectKey(); await checkKey(); }
  };

  // Asset Handlers
  const saveCharacter = () => {
    const newChar = { ...charData };
    if (!newChar.id) newChar.id = Date.now().toString();
    setCharacterLibrary(prev => {
      const idx = prev.findIndex(c => c.id === newChar.id);
      if (idx >= 0) { const updated = [...prev]; updated[idx] = newChar; return updated; }
      return [...prev, newChar];
    });
    setCharData(newChar);
  };
  const loadCharacter = (id: string) => {
    if (!id) { setCharData(initialCharData); return; }
    const found = characterLibrary.find(c => c.id === id);
    if (found) setCharData(found);
  };
  const deleteCharacter = () => {
     if (!charData.id) return;
     if (window.confirm("Delete character?")) { setCharacterLibrary(prev => prev.filter(c => c.id !== charData.id)); setCharData(initialCharData); }
  };
  const newCharacter = () => setCharData(initialCharData);

  const saveEnvironment = () => {
    const newEnv = { ...envData };
    if (!newEnv.id) newEnv.id = Date.now().toString();
    setEnvironmentLibrary(prev => {
      const idx = prev.findIndex(e => e.id === newEnv.id);
      if (idx >= 0) { const updated = [...prev]; updated[idx] = newEnv; return updated; }
      return [...prev, newEnv];
    });
    setEnvData(newEnv);
  };
  const loadEnvironment = (id: string) => {
    if (!id) { setEnvData(initialEnvData); return; }
    const found = environmentLibrary.find(e => e.id === id);
    if (found) setEnvData(found);
  };
  const deleteEnvironment = () => {
     if (!envData.id) return;
     if (window.confirm("Delete environment?")) { setEnvironmentLibrary(prev => prev.filter(e => e.id !== envData.id)); setEnvData(initialEnvData); }
  };
  const newEnvironment = () => setEnvData(initialEnvData);

  const saveProp = () => {
    const newProp = { ...propData };
    if (!newProp.id) newProp.id = Date.now().toString();
    setPropLibrary(prev => {
      const idx = prev.findIndex(p => p.id === newProp.id);
      if (idx >= 0) { const updated = [...prev]; updated[idx] = newProp; return updated; }
      return [...prev, newProp];
    });
    setPropData(newProp);
  };
  const loadProp = (id: string) => {
    if (!id) { setPropData(initialPropData); return; }
    const found = propLibrary.find(p => p.id === id);
    if (found) setPropData(found);
  };
  const deleteProp = () => {
     if (!propData.id) return;
     if (window.confirm("Delete prop?")) { setPropLibrary(prev => prev.filter(p => p.id !== propData.id)); setPropData(initialPropData); }
  };
  const newProp = () => setPropData(initialPropData);

  const handleSaveElement = (type: AppMode, name: string, desc: string, imageUrl: string) => {
    const newElement: SavedElement = { id: Date.now().toString(), type, name, description: desc, imageUrl };
    setSavedElements(prev => [...prev, newElement]);
  };

  const breakDownStory = () => {
      if (!storyData.fullStory) return;
      const segments = storyData.fullStory.split(/\n\n+/).filter(s => s.trim().length > 0);
      setStoryData(prev => ({ ...prev, storyScenes: segments }));
  };

  const updateSceneText = (index: number, newText: string) => {
      const newScenes = [...storyData.storyScenes];
      newScenes[index] = newText;
      setStoryData(prev => ({ ...prev, storyScenes: newScenes }));
  };

  const randomize = () => {
    const r = RANDOM_POOL;
    if (mode === AppMode.GLOBALS) {
      setGlobalData({
        ...globalData,
        style: r.visualStyles[Math.floor(Math.random() * r.visualStyles.length)],
        timePeriod: r.timePeriods[Math.floor(Math.random() * r.timePeriods.length)],
        genre: r.genres[Math.floor(Math.random() * r.genres.length)],
        lightingTheme: r.lightingThemes[Math.floor(Math.random() * r.lightingThemes.length)],
      });
    } else if (mode === AppMode.CHARACTER) {
      setCharData({
        ...charData,
        name: r.names[Math.floor(Math.random() * r.names.length)],
        species: r.species[Math.floor(Math.random() * r.species.length)],
        age: `${Math.floor(Math.random() * 80) + 18}`,
        role: r.roles[Math.floor(Math.random() * r.roles.length)],
        archetype: r.archetypes[Math.floor(Math.random() * r.archetypes.length)],
        voiceProfile: r.voices[Math.floor(Math.random() * r.voices.length)],
        voiceDescription: r.voiceDescriptions[Math.floor(Math.random() * r.voiceDescriptions.length)],
        height: r.heights[Math.floor(Math.random() * r.heights.length)],
        build: r.builds[Math.floor(Math.random() * r.builds.length)],
        hairColor: r.hairColors[Math.floor(Math.random() * r.hairColors.length)],
        eyeColor: r.eyeColors[Math.floor(Math.random() * r.eyeColors.length)],
        skinTone: r.skinTones[Math.floor(Math.random() * r.skinTones.length)],
        scent: r.scents[Math.floor(Math.random() * r.scents.length)],
        distinguishingFeatures: r.features[Math.floor(Math.random() * r.features.length)],
        tattoosMarkings: r.tattoos[Math.floor(Math.random() * r.tattoos.length)],
        postureGait: r.gaits[Math.floor(Math.random() * r.gaits.length)],
        clothingStyle: r.clothing[Math.floor(Math.random() * r.clothing.length)],
        alignment: r.alignments[Math.floor(Math.random() * r.alignments.length)],
        intelligence: r.intelligences[Math.floor(Math.random() * r.intelligences.length)],
        motivation: r.motivations[Math.floor(Math.random() * r.motivations.length)],
        flaws: r.flaws[Math.floor(Math.random() * r.flaws.length)],
        personality: r.personalityTraits[Math.floor(Math.random() * r.personalityTraits.length)],
        phobias: r.phobias[Math.floor(Math.random() * r.phobias.length)],
        hobbies: r.hobbies[Math.floor(Math.random() * r.hobbies.length)],
        placeOfBirth: r.places[Math.floor(Math.random() * r.places.length)],
        socialClass: r.socialClasses[Math.floor(Math.random() * r.socialClasses.length)],
        beliefs: r.beliefs[Math.floor(Math.random() * r.beliefs.length)],
        languages: r.languages[Math.floor(Math.random() * r.languages.length)],
        reputation: r.reputations[Math.floor(Math.random() * r.reputations.length)],
        allies: r.allies[Math.floor(Math.random() * r.allies.length)],
        enemies: r.enemies[Math.floor(Math.random() * r.enemies.length)],
        backstory: r.backstories[Math.floor(Math.random() * r.backstories.length)],
        secrets: r.secrets[Math.floor(Math.random() * r.secrets.length)],
        signatureWeapon: r.weapons[Math.floor(Math.random() * r.weapons.length)],
        combatStyle: r.combatStyles[Math.floor(Math.random() * r.combatStyles.length)],
        specialAbilities: r.abilities[Math.floor(Math.random() * r.abilities.length)],
        petCompanion: r.pets[Math.floor(Math.random() * r.pets.length)],
        visualStyle: r.visualStyles[Math.floor(Math.random() * r.visualStyles.length)],
      });
    } else if (mode === AppMode.ENVIRONMENT) {
      setEnvData({
        ...envData,
        name: r.names[Math.floor(Math.random() * r.names.length)] + "'s Haven",
        biome: r.biomes[Math.floor(Math.random() * r.biomes.length)],
        timeOfDay: r.times[Math.floor(Math.random() * r.times.length)],
        weather: r.weathers[Math.floor(Math.random() * r.weathers.length)],
        atmosphere: r.atmospheres[Math.floor(Math.random() * r.atmospheres.length)],
        architecture: r.architectures[Math.floor(Math.random() * r.architectures.length)],
        lighting: r.lightingThemes[Math.floor(Math.random() * r.lightingThemes.length)],
        visualStyle: r.visualStyles[Math.floor(Math.random() * r.visualStyles.length)],
        history: "A forgotten site of immense power.",
        scale: "Vast", colors: "Cinematic hues"
      });
    } else if (mode === AppMode.PROP) {
      setPropData({
        ...propData,
        name: r.materials[Math.floor(Math.random() * r.materials.length)] + " Relic",
        category: r.propCategories[Math.floor(Math.random() * r.propCategories.length)],
        material: r.materials[Math.floor(Math.random() * r.materials.length)],
        properties: r.properties[Math.floor(Math.random() * r.properties.length)],
        condition: "Aged", origin: "Ancient Era", visualStyle: "Mythic"
      });
    } else if (mode === AppMode.STORY) {
      setStoryData({
        ...storyData,
        synopsis: "The journey begins as a strange artifact is discovered in the ruins of a lost civilization.",
        storyScenes: []
      });
    }
  };

  const applyGlobals = () => {
    if (mode === AppMode.CHARACTER) {
      setCharData(prev => ({ ...prev, visualStyle: globalData.style || prev.visualStyle, backstory: globalData.timePeriod ? `Originating from the ${globalData.timePeriod}. ${prev.backstory}` : prev.backstory }));
    } else if (mode === AppMode.ENVIRONMENT) {
      setEnvData(prev => ({ ...prev, visualStyle: globalData.style || prev.visualStyle, lighting: globalData.lightingTheme || prev.lighting }));
    } else if (mode === AppMode.PROP) {
      setPropData(prev => ({ ...prev, visualStyle: globalData.style || prev.visualStyle }));
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleStyleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files) as File[];
      const remainingSlots = 9 - globalData.styleReferenceImages.length;
      if (files.length > remainingSlots) { alert(`Max 9 images.`); return; }
      files.slice(0, remainingSlots).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => { setGlobalData(prev => ({ ...prev, styleReferenceImages: [...prev.styleReferenceImages, reader.result as string] })); };
        reader.readAsDataURL(file);
      });
    }
  };

  const getApiKey = () => globalData.customApiKey?.trim() || process.env.API_KEY || "";

  const sendToAI = async (text: string, isStoryGen = false) => {
    setIsChatOpen(true);
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    setChatInput('');
    setIsTyping(true);
    try {
      const apiKey = getApiKey();
      const ai = new GoogleGenAI({ apiKey });
      let contents;
      if (isStoryGen) {
         const context = savedElements.map(el => `[Saved ${el.type}]: ${el.name} - ${el.description}`).join('\n');
         contents = [{ parts: [{ text: PROMPT_TEMPLATES.storyGen(text, context) }], role: 'user' }];
      } else {
         contents = [...chatMessages.map(m => ({ parts: [{ text: m.text }], role: m.role })), { parts: [{ text }], role: 'user' }];
      }
      const stream = await ai.models.generateContentStream({ model: 'gemini-3-pro-preview', contents });
      let fullText = '';
      setChatMessages(prev => [...prev, { role: 'model', text: '' }]);
      for await (const chunk of stream) {
        if (chunk.text) {
          fullText += chunk.text;
          setChatMessages(prev => {
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), { ...last, text: fullText }];
          });
        }
      }
      if (isStoryGen) setStoryData(prev => ({ ...prev, fullStory: fullText }));
    } catch (error: any) {
      console.error(error);
      setChatMessages(prev => [...prev, { role: 'model', text: `Error: ${error.message}.`, status: 'error' }]);
    } finally { setIsTyping(false); }
  };

  const generateVoice = async (textToSpeak: string) => {
    const apiKey = getApiKey();
    if (!hasKey && !apiKey && charData.voiceProvider === 'Gemini') { await handleOpenKey(); return; }
    const spokenText = textToSpeak || `${charData.name}. ${charData.personality}`;
    setIsChatOpen(true);
    setIsTyping(true);
    setGenStatus(`Voice synthesis active...`);
    try {
      let base64Audio = "";
      if (charData.voiceProvider === 'ElevenLabs') {
          if (!globalData.elevenLabsApiKey || !charData.elevenLabsVoiceId) { throw new Error("Missing ElevenLabs credentials."); }
          const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${charData.elevenLabsVoiceId}`, {
              method: 'POST',
              headers: { 'xi-api-key': globalData.elevenLabsApiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: spokenText, model_id: "eleven_monolingual_v1" })
          });
          if (!response.ok) { throw new Error("ElevenLabs API failure."); }
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(arrayBuffer);
          for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
          base64Audio = btoa(binary);
      } else {
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: { parts: [{ text: spokenText }] },
            config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: charData.voiceProfile } } } }
          });
          base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
      }
      if (base64Audio) {
        await playAudio(base64Audio);
        setChatMessages(prev => [...prev, { role: 'model', text: `Audio generated.`, audioData: base64Audio }]);
      } else { throw new Error("No audio data."); }
    } catch (error: any) {
      setChatMessages(prev => [...prev, { role: 'model', text: `Voice Error: ${error.message}.`, status: 'error' }]);
    } finally { setIsTyping(false); setGenStatus(''); }
  };

  const generateImage = async (promptText: string, options: { isStoryboard?: boolean, isMultiView?: boolean, specificRef?: string } = {}) => {
    const { isStoryboard = false, isMultiView = false, specificRef } = options;
    const apiKey = getApiKey();
    if (!hasKey && !apiKey) { await handleOpenKey(); return; }
    let uploadedRef: string | undefined;
    if (mode === AppMode.CHARACTER) uploadedRef = charData.customImage;
    else if (mode === AppMode.ENVIRONMENT) uploadedRef = envData.customImage;
    else if (mode === AppMode.PROP) uploadedRef = propData.customImage;
    setIsChatOpen(true);
    setIsTyping(true);
    setGenStatus('Visual manifesting...');
    try {
      const ai = new GoogleGenAI({ apiKey });
      const contents: any = { parts: [] };
      let promptPrefix = "";
      if (globalData.styleReferenceImages.length > 0) {
        globalData.styleReferenceImages.forEach(imgData => { contents.parts.push({ inlineData: { data: imgData.split(',')[1], mimeType: imgData.split(';')[0].split(':')[1] } }); });
        promptPrefix += ` Use provided visual style.`;
      }
      if (specificRef) { contents.parts.push({ inlineData: { data: specificRef.split(',')[1], mimeType: 'image/png' } }); }
      else if (uploadedRef) { contents.parts.push({ inlineData: { data: uploadedRef.split(',')[1], mimeType: 'image/png' } }); }
      const finalPrompt = `${promptPrefix} Professional Concept Art: ${promptText}. Cinematic, 8k, ${globalData.style}.`;
      contents.parts.push({ text: finalPrompt });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents,
        config: { imageConfig: { aspectRatio: isStoryboard ? "4:3" : globalData.aspectRatio, imageSize: globalData.imageQuality } }
      });
      let imageUrl = '';
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) { if (part.inlineData) { imageUrl = `data:image/png;base64,${part.inlineData.data}`; break; } }
      }
      if (imageUrl) {
        setChatMessages(prev => [...prev, { role: 'model', text: `Visualized.`, image: imageUrl, isStoryboard, isMultiView }]);
        if (!isStoryboard && !specificRef && !uploadedRef) { setActiveRefImage(imageUrl); }
      } else { throw new Error("Empty image payload"); }
    } catch (error: any) {
      setChatMessages(prev => [...prev, { role: 'model', text: `Visual Failed: ${error.message}.`, status: 'error' }]);
    } finally { setIsTyping(false); setGenStatus(''); }
  };

  const getActivePrompts = (): { title: string; icon: string; content: string }[] => {
    switch (mode) {
      case AppMode.CHARACTER:
        return [
          { title: 'Narrative Profile', icon: 'fa-book-open', content: PROMPT_TEMPLATES.characterNarrative(charData) },
          { title: 'Visual Description', icon: 'fa-camera', content: PROMPT_TEMPLATES.characterVisual(charData) },
          { title: 'Midjourney Prompt', icon: 'fa-brands fa-discord', content: PROMPT_TEMPLATES.midjourneyPrompt(charData) }
        ];
      case AppMode.ENVIRONMENT:
        return [
          { title: 'Cinematic', icon: 'fa-clapperboard', content: PROMPT_TEMPLATES.envCinematic(envData) },
          { title: 'World Lore', icon: 'fa-globe', content: PROMPT_TEMPLATES.envWorldbuilding(envData) }
        ];
      case AppMode.PROP:
        return [
          { title: 'Technical Spec', icon: 'fa-microscope', content: PROMPT_TEMPLATES.propDescription(propData) },
          { title: 'Mythic Relic', icon: 'fa-crown', content: PROMPT_TEMPLATES.propRelic(propData) }
        ];
      default: return [];
    }
  };
  
  const activePrompts = getActivePrompts();
  const activePromptData = activePrompts[activeFooterTab];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200 pb-64 relative overflow-hidden">
      {/* Header with Quick Save */}
      <header className="py-6 px-8 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-500 rounded-lg flex items-center justify-center shadow-lg shadow-yellow-500/20">
            <i className="fa-solid fa-bolt text-slate-900 text-xl"></i>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white hidden sm:block">MythosForge</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-3 mr-4 px-4 py-1.5 bg-slate-800 rounded-full border border-slate-700">
             <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Active:</span>
             <span className="text-xs font-bold text-slate-200">{currentSessionName}</span>
             <button onClick={handleSaveSession} title="Quick Save Progress" className="text-indigo-400 hover:text-white transition-colors">
               <i className="fa-solid fa-floppy-disk"></i>
             </button>
          </div>
          <button onClick={() => setIsChronicleOpen(true)} className="text-xs font-bold text-slate-950 bg-yellow-500 hover:bg-yellow-400 px-4 py-1.5 rounded-full transition-all border border-yellow-600">
            <i className="fa-solid fa-book-open"></i> <span className="hidden sm:inline">Chronicle</span>
          </button>
          <button onClick={() => setIsSessionMenuOpen(true)} className="text-xs font-bold text-slate-400 hover:text-white bg-slate-800 px-3 py-1.5 rounded-full transition-all border border-slate-700">
            <i className="fa-solid fa-folder-open"></i> <span className="hidden sm:inline">Sessions</span>
          </button>
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-slate-500 hover:text-white transition-colors"><i className="fa-solid fa-gear"></i></button>
        </div>
      </header>

      {/* Mode Navigation */}
      <div className="bg-slate-900/30 border-b border-slate-800 px-8 py-4 sticky top-20 z-40 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex gap-4 overflow-x-auto pb-1">
          {[AppMode.GLOBALS, AppMode.CHARACTER, AppMode.ENVIRONMENT, AppMode.PROP, AppMode.STORY].map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setActiveFooterTab(0); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                mode === m ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <i className={`fa-solid ${m === AppMode.GLOBALS ? 'fa-sliders' : m === AppMode.CHARACTER ? 'fa-user' : m === AppMode.ENVIRONMENT ? 'fa-mountain' : m === AppMode.STORY ? 'fa-book-skull' : 'fa-cube'}`}></i>
              {m === AppMode.GLOBALS ? m : m === AppMode.STORY ? 'Story' : `${m}s`}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row gap-6 items-center justify-between mb-10">
          <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            {Object.values(DetailLevel).map((l) => (
              <button key={l} onClick={() => setLevel(l)} className={`px-4 py-2 text-xs font-semibold rounded-md transition-all ${level === l ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {mode !== AppMode.GLOBALS && <button onClick={applyGlobals} className="flex items-center gap-2 px-6 py-2.5 bg-green-500/10 text-green-400 border border-green-500/30 rounded-full text-sm font-semibold transition-all">Autofill Globals</button>}
            <button onClick={randomize} className="flex items-center gap-2 px-6 py-2.5 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded-full text-sm font-semibold transition-all group">Chaos Seed</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {mode === AppMode.CHARACTER && (
            <>
              <div className="col-span-full">
                <AssetManager label="Character" library={characterLibrary} currentId={charData.id} onLoad={loadCharacter} onSave={saveCharacter} onNew={newCharacter} onDelete={deleteCharacter} />
              </div>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <VisualReference imageData={charData.customImage} onUpload={(img) => setCharData({...charData, customImage: img})} onClear={() => setCharData({...charData, customImage: undefined})} />
                <SectionTitle title="Identity" icon="fa-dna" />
                <InputField label="Name" value={charData.name} onChange={(v) => setCharData({...charData, name: v})} />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Species" value={charData.species} onChange={(v) => setCharData({...charData, species: v})} />
                  <InputField label="Age" value={charData.age} onChange={(v) => setCharData({...charData, age: v})} />
                </div>
              </section>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Physicality" icon="fa-person-rays" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Height" value={charData.height} onChange={(v) => setCharData({...charData, height: v})} />
                  <InputField label="Build" value={charData.build} onChange={(v) => setCharData({...charData, build: v})} />
                </div>
                <InputField label="Backstory" value={charData.backstory} onChange={(v) => setCharData({...charData, backstory: v})} isTextArea />
              </section>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Psyche" icon="fa-brain" />
                <InputField label="Personality" value={charData.personality} onChange={(v) => setCharData({...charData, personality: v})} isTextArea />
                <InputField label="Motivation" value={charData.motivation} onChange={(v) => setCharData({...charData, motivation: v})} />
              </section>
            </>
          )}

          {mode === AppMode.ENVIRONMENT && (
            <>
              <div className="col-span-full">
                <AssetManager label="Environment" library={environmentLibrary} currentId={envData.id} onLoad={loadEnvironment} onSave={saveEnvironment} onNew={newEnvironment} onDelete={deleteEnvironment} />
              </div>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <VisualReference imageData={envData.customImage} onUpload={(img) => setEnvData({...envData, customImage: img})} onClear={() => setEnvData({...envData, customImage: undefined})} />
                <SectionTitle title="Locale" icon="fa-mountain-city" />
                <InputField label="Name" value={envData.name} onChange={(v) => setEnvData({...envData, name: v})} />
                <InputField label="Biome" value={envData.biome} onChange={(v) => setEnvData({...envData, biome: v})} />
              </section>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Ambience" icon="fa-cloud-sun" />
                <InputField label="Atmosphere" value={envData.atmosphere} onChange={(v) => setEnvData({...envData, atmosphere: v})} />
                <InputField label="Architecture" value={envData.architecture} onChange={(v) => setEnvData({...envData, architecture: v})} />
              </section>
            </>
          )}

          {mode === AppMode.PROP && (
            <>
              <div className="col-span-full">
                <AssetManager label="Prop" library={propLibrary} currentId={propData.id} onLoad={loadProp} onSave={saveProp} onNew={newProp} onDelete={deleteProp} />
              </div>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <VisualReference imageData={propData.customImage} onUpload={(img) => setPropData({...propData, customImage: img})} onClear={() => setPropData({...propData, customImage: undefined})} />
                <SectionTitle title="Item" icon="fa-box" />
                <InputField label="Name" value={propData.name} onChange={(v) => setPropData({...propData, name: v})} />
                <InputField label="Properties" value={propData.properties} onChange={(v) => setPropData({...propData, properties: v})} isTextArea />
              </section>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Specs" icon="fa-ruler-combined" />
                <InputField label="Material" value={propData.material} onChange={(v) => setPropData({...propData, material: v})} />
                <InputField label="Size" value={propData.size} onChange={(v) => setPropData({...propData, size: v})} />
              </section>
            </>
          )}

          {mode === AppMode.STORY && (
            <>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4 col-span-1 lg:col-span-2">
                <SectionTitle title="Story Studio" icon="fa-pen-nib" />
                <InputField label="Synopsis" value={storyData.synopsis} onChange={(v) => setStoryData({...storyData, synopsis: v})} isTextArea />
                <button onClick={() => sendToAI(storyData.synopsis, true)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold text-white transition-all shadow-lg shadow-indigo-600/20">Generate Narrative</button>
                <InputField label="Full Story" value={storyData.fullStory} onChange={(v) => setStoryData({...storyData, fullStory: v})} isTextArea rows={12} />
              </section>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4 h-fit">
                <SectionTitle title="Registry" icon="fa-box-archive" />
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                   {savedElements.length === 0 ? <div className="text-center py-12 text-slate-600 italic">Vault is empty.</div> : savedElements.map((el) => (
                     <div key={el.id} className="flex gap-3 bg-slate-800 p-2 rounded-lg border border-slate-700">
                         <div className="w-12 h-12 rounded bg-slate-700 overflow-hidden"><img src={el.imageUrl} alt={el.name} className="w-full h-full object-cover" /></div>
                         <div className="flex-1 min-w-0"><h4 className="font-bold text-sm truncate">{el.name}</h4><p className="text-[10px] text-slate-400 uppercase">{el.type}</p></div>
                         <button onClick={() => setSavedElements(prev => prev.filter(x => x.id !== el.id))} className="text-slate-600 hover:text-red-400"><i className="fa-solid fa-trash"></i></button>
                     </div>
                   ))}
                </div>
              </section>
            </>
          )}

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
                   <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-400">Aspect Ratio</label><select value={globalData.aspectRatio} onChange={(e) => setGlobalData({...globalData, aspectRatio: e.target.value as any})} className="bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm text-slate-200 outline-none"><option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select></div>
                   <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-400">Quality</label><select value={globalData.imageQuality} onChange={(e) => setGlobalData({...globalData, imageQuality: e.target.value as any})} className="bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm text-slate-200 outline-none"><option value="1K">1K</option><option value="2K">2K</option></select></div>
                 </div>
               </section>
             </>
          )}
        </div>
      </main>

      {/* Overlays */}
      <SessionModal 
        isOpen={isSessionMenuOpen} 
        onClose={() => setIsSessionMenuOpen(false)} 
        sessions={sessions}
        currentName={currentSessionName}
        onRename={setCurrentSessionName}
        onSave={handleSaveSession}
        onLoad={handleLoadSession}
        onDelete={handleDeleteSession}
        onNew={handleNewSession}
      />
      <ChronicleView 
        isOpen={isChronicleOpen} 
        onClose={() => setIsChronicleOpen(false)} 
        session={{ name: currentSessionName, charLibrary: characterLibrary, envLibrary: environmentLibrary, propLibrary: propLibrary, story: storyData, globals: globalData }} 
      />

      {/* Prompt Tabs Footer */}
      {mode !== AppMode.GLOBALS && mode !== AppMode.STORY && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-yellow-500/20 shadow-2xl z-40 p-0 flex flex-col h-64">
          <div className="flex bg-slate-950/80 border-b border-slate-800">
            {activePrompts.map((p, idx) => (
              <button key={idx} onClick={() => setActiveFooterTab(idx)} className={`flex-1 py-3 text-xs font-bold uppercase transition-all flex items-center justify-center gap-2 ${activeFooterTab === idx ? 'text-yellow-500 bg-slate-900 border-t-2 border-yellow-500 shadow-[inset_0_2px_10px_rgba(234,179,8,0.1)]' : 'text-slate-500 hover:bg-slate-800'}`}>
                <i className={`fa-solid ${p.icon}`}></i><span className="hidden sm:inline">{p.title}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 p-4 md:p-6 overflow-hidden flex flex-col">
             <div className="flex justify-between items-center mb-3">
                 <h3 className="text-yellow-500 font-bold text-sm uppercase flex items-center gap-2"><i className={`fa-solid ${activePromptData?.icon}`}></i>{activePromptData?.title}</h3>
                 <div className="flex gap-2">
                    <button onClick={() => generateImage(activePromptData?.content || "")} className="px-4 py-1.5 bg-yellow-500/10 text-yellow-500 rounded text-xs font-black uppercase transition-all border border-yellow-500/30 flex items-center gap-2"><i className="fa-solid fa-image"></i>Visualize</button>
                    {mode === AppMode.CHARACTER && <button onClick={() => generateVoice(activePromptData?.content.substring(0, 200) || "")} className="px-4 py-1.5 bg-pink-500/10 text-pink-500 rounded text-xs font-black uppercase transition-all border border-pink-500/30 flex items-center gap-2"><i className="fa-solid fa-microphone-lines"></i>Speak</button>}
                    <button onClick={() => copyToClipboard(activePromptData?.content || "", activeFooterTab)} className={`px-4 py-1.5 rounded text-xs font-bold uppercase transition-all ${copiedIndex === activeFooterTab ? 'bg-green-600' : 'bg-slate-800 text-slate-300'}`}>{copiedIndex === activeFooterTab ? 'Copied' : 'Copy'}</button>
                 </div>
             </div>
             <div className="flex-1 bg-slate-950 rounded-lg p-4 mono text-xs leading-relaxed text-slate-300 overflow-y-auto border border-slate-800 select-all"><pre className="whitespace-pre-wrap font-mono">{activePromptData?.content}</pre></div>
          </div>
        </div>
      )}

      {/* FAB and Chat Sidebar */}
      <button onClick={() => setIsChatOpen(!isChatOpen)} className="fixed bottom-32 right-8 w-14 h-14 bg-yellow-500 hover:bg-yellow-400 text-slate-950 rounded-full shadow-2xl z-50 flex items-center justify-center transition-all border-4 border-slate-900 active:scale-90">
        <i className={`fa-solid ${isChatOpen ? 'fa-times' : 'fa-brain'} text-xl`}></i>
      </button>

      <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl z-[60] transform transition-transform duration-300 flex flex-col ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <div className="flex items-center gap-3"><div className="w-8 h-8 bg-yellow-500 rounded flex items-center justify-center"><i className="fa-solid fa-bolt text-slate-950 text-sm"></i></div><span className="font-black text-yellow-500 uppercase tracking-tighter text-sm">Pro Studio</span></div>
          <button onClick={() => setIsChatOpen(false)} className="text-slate-500 hover:text-white p-2 transition-colors"><i className="fa-solid fa-xmark text-xl"></i></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.length === 0 && <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs text-center p-8 uppercase tracking-widest font-black opacity-30 gap-4"><i className="fa-solid fa-wand-magic-sparkles text-4xl"></i><p>Awaiting manifestation pass...</p></div>}
          {chatMessages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] p-4 rounded-2xl text-sm ${m.role === 'user' ? 'bg-indigo-600/20 border border-indigo-500/30 text-slate-100 rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700'}`}>
                {m.text}
                {m.image && (
                  <div className="mt-4 flex flex-col gap-2">
                      <div className="rounded-lg overflow-hidden border border-slate-700 shadow-2xl bg-slate-950 relative group">
                        <img src={m.image} className="w-full h-auto" />
                        <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><button onClick={() => { const l=document.createElement('a'); l.href=m.image!; l.download='forge.png'; l.click(); }} className="p-3 bg-yellow-500 text-slate-950 rounded-full"><i className="fa-solid fa-download"></i></button></div>
                      </div>
                      <button onClick={() => { const n = mode === AppMode.CHARACTER ? charData.name : mode === AppMode.ENVIRONMENT ? envData.name : propData.name; handleSaveElement(mode, n || 'Untitled', m.text.substring(0, 100), m.image!); }} className="w-full py-2 bg-slate-700 hover:bg-green-600 text-white text-xs font-bold rounded flex items-center justify-center gap-2 transition-colors"><i className="fa-solid fa-floppy-disk"></i>Add to Registry</button>
                  </div>
                )}
                {m.audioData && (
                  <div className="mt-4 bg-slate-900 p-3 rounded-lg border border-slate-700 flex items-center gap-3">
                    <button onClick={() => playAudio(m.audioData!)} className="w-10 h-10 rounded-full bg-pink-500 text-slate-950 flex items-center justify-center transition-transform hover:scale-105"><i className="fa-solid fa-play"></i></button>
                    <div className="flex-1 text-[10px] text-slate-400 uppercase tracking-widest font-black">Voice Output</div>
                    <button onClick={() => downloadAudio(m.audioData!, charData.name, m.text, charData.voiceProvider === 'ElevenLabs')} className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center transition-colors"><i className="fa-solid fa-download"></i></button>
                  </div>
                )}
                {idx === chatMessages.length - 1 && isTyping && <div className="mt-2 flex items-center gap-2"><span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce"></span><span className="text-[10px] text-yellow-500/60 font-black uppercase animate-pulse">{genStatus}</span></div>}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (chatInput.trim()) sendToAI(chatInput); }} className="p-4 bg-slate-950 border-t border-slate-800">
          <div className="relative">
            <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Refine chronicle..." className="w-full bg-slate-900 border border-slate-700 rounded-xl py-4 pl-5 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50 transition-all text-slate-200" />
            <button type="submit" disabled={isTyping || !chatInput.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-yellow-500 hover:text-yellow-400 disabled:opacity-20 transition-all"><i className="fa-solid fa-paper-plane text-lg"></i></button>
          </div>
        </form>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} apiKey={globalData.customApiKey || ''} elevenLabsKey={globalData.elevenLabsApiKey || ''} onApiKeyChange={(k) => setGlobalData({...globalData, customApiKey: k})} onElevenLabsKeyChange={(k) => setGlobalData({...globalData, elevenLabsApiKey: k})} />
    </div>
  );
}

const InputField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isTextArea?: boolean;
  rows?: number;
}> = ({ label, value, onChange, placeholder, isTextArea, rows = 3 }) => (
  <div className="flex flex-col gap-1.5 w-full">
    <label className="text-xs font-medium text-slate-400">{label}</label>
    {isTextArea ? (
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30 transition-all resize-none text-slate-200" />
    ) : (
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30 transition-all text-slate-200" />
    )}
  </div>
);

const SectionTitle: React.FC<{ title: string; icon: string }> = ({ title, icon }) => (
  <h3 className="text-sm font-semibold text-yellow-500/80 uppercase tracking-wider mb-4 flex items-center gap-2">
    <i className={`fa-solid ${icon}`}></i> {title}
  </h3>
);

const VisualReference: React.FC<{ imageData?: string; onUpload: (data: string) => void; onClear: () => void; }> = ({ imageData, onUpload, onClear }) => {
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onloadend = () => onUpload(reader.result as string);
      reader.readAsDataURL(e.target.files[0]);
    }
  };
  return (
    <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 mb-4">
      <div className="flex flex-col gap-3">
        {!imageData ? (
          <div className="relative group w-full h-24">
            <input type="file" accept="image/*" onChange={handleUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="border-2 border-dashed border-slate-700 rounded-xl h-full flex flex-col items-center justify-center gap-2 text-slate-500 group-hover:border-yellow-500/50 group-hover:text-yellow-500 transition-colors bg-slate-800/50">
              <i className="fa-solid fa-image text-xl"></i><span className="text-[10px] font-black uppercase tracking-widest">Add Ref</span>
            </div>
          </div>
        ) : (
          <div className="relative rounded-lg overflow-hidden border border-slate-700 group w-full aspect-video">
            <img src={imageData} alt="Ref" className="w-full h-full object-cover" />
            <button onClick={onClear} className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"><i className="fa-solid fa-xmark"></i></button>
          </div>
        )}
      </div>
    </div>
  );
};

const AssetManager: React.FC<{ library: any[]; currentId?: string; onLoad: (id: string) => void; onSave: () => void; onNew: () => void; onDelete: () => void; label: string; }> = ({ library, currentId, onLoad, onSave, onNew, onDelete, label }) => (
  <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row gap-4 items-center mb-6 shadow-lg">
    <div className="flex-1 w-full flex flex-col gap-1">
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label} Stack</label>
      <select value={currentId || ""} onChange={(e) => onLoad(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-yellow-500/30">
        <option value="">-- Workspace Draft --</option>
        {library.map((item: any) => (<option key={item.id} value={item.id}>{item.name || "Untitled"}</option>))}
      </select>
    </div>
    <div className="flex gap-2 w-full sm:w-auto pt-5">
      <button onClick={onNew} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg transition-colors border border-slate-700" title="New Draft"><i className="fa-solid fa-plus"></i></button>
      <button onClick={onSave} className="flex-1 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"><i className="fa-solid fa-floppy-disk"></i>Save Stack</button>
      {currentId && <button onClick={onDelete} className="p-2 text-slate-600 hover:text-red-500 transition-colors"><i className="fa-solid fa-trash"></i></button>}
    </div>
  </div>
);

const SettingsModal: React.FC<{ isOpen: boolean; onClose: () => void; apiKey: string; elevenLabsKey: string; onApiKeyChange: (k: string) => void; onElevenLabsKeyChange: (k: string) => void; }> = ({ isOpen, onClose, apiKey, elevenLabsKey, onApiKeyChange, onElevenLabsKeyChange }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center"><h2 className="text-xl font-bold text-white">System Keys</h2><button onClick={onClose} className="text-slate-500 hover:text-white"><i className="fa-solid fa-xmark"></i></button></div>
        <div className="p-6 space-y-4">
           <InputField label="Google GenAI API Key" type="password" value={apiKey} onChange={onApiKeyChange} />
           <InputField label="ElevenLabs API Key" type="password" value={elevenLabsKey} onChange={onElevenLabsKeyChange} />
           <button onClick={onClose} className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-lg mt-2">Update Credentials</button>
        </div>
      </div>
    </div>
  );
};
