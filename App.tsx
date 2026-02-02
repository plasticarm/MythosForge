
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

// Helper to write string to DataView
const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

// Adds WAV header to raw PCM data
const getWavBytes = (pcmData: Uint8Array, sampleRate: number): Uint8Array => {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const channels = 1;
  const bitDepth = 16;
  
  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + pcmData.length, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 is PCM)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, channels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * channels * (bitDepth / 8), true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, channels * (bitDepth / 8), true);
  // bits per sample
  view.setUint16(34, bitDepth, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, pcmData.length, true);
  
  // Combine header and data
  const wavFile = new Uint8Array(header.byteLength + pcmData.length);
  wavFile.set(new Uint8Array(header), 0);
  wavFile.set(pcmData, 44);
  
  return wavFile;
};

const playAudio = async (base64Data: string) => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const bytes = decode(base64Data);
    
    // Convert Int16 PCM to Float32 for AudioBuffer
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = audioContext.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
    }
    
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
  } catch (e) {
    console.error("Audio playback error:", e);
  }
};

const downloadAudio = (base64Data: string, charName: string, contentText: string) => {
  try {
    const bytes = decode(base64Data);
    const wavBytes = getWavBytes(bytes, 24000); // Gemini Flash TTS is 24kHz
    const blob = new Blob([wavBytes], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    // Sanitize filename
    const safeName = (charName || 'Character').trim().replace(/[^a-z0-9]/gi, '_');
    // Extract a short summary from the text, remove quotes and special chars
    const safeText = contentText.replace(/["']/g, '').trim().substring(0, 20).replace(/[^a-z0-9]/gi, '_');
    
    link.href = url;
    link.download = `${safeName}_${safeText}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download error:", e);
  }
};

// --- Components ---

const Header: React.FC<{ onOpenSessions: () => void, onOpenExport: () => void }> = ({ onOpenSessions, onOpenExport }) => (
  <header className="py-6 px-8 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-yellow-500 rounded-lg flex items-center justify-center shadow-lg shadow-yellow-500/20">
        <i className="fa-solid fa-bolt text-slate-900 text-xl"></i>
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-white">MythosForge</h1>
    </div>
    <div className="flex items-center gap-3">
      <button 
        onClick={onOpenExport}
        className="text-xs font-bold text-green-500 hover:text-green-400 flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-all border border-green-500/20"
      >
        <i className="fa-solid fa-file-export"></i>
        Export
      </button>
      <button 
        onClick={onOpenSessions}
        className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-all"
      >
        <i className="fa-solid fa-folder-open"></i>
        Sessions
      </button>
      <div className="text-xs uppercase tracking-widest text-yellow-500 font-black flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-ping"></span>
        Nanobanana Pro V3
      </div>
    </div>
  </header>
);

const SectionTitle: React.FC<{ title: string; icon: string }> = ({ title, icon }) => (
  <h3 className="text-sm font-semibold text-yellow-500/80 uppercase tracking-wider mb-4 flex items-center gap-2">
    <i className={`fa-solid ${icon}`}></i>
    {title}
  </h3>
);

const InputField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isTextArea?: boolean;
  type?: string;
}> = ({ label, value, onChange, placeholder, isTextArea, type = "text" }) => (
  <div className="flex flex-col gap-1.5 w-full">
    <label className="text-xs font-medium text-slate-400">{label}</label>
    {isTextArea ? (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30 transition-all resize-none text-slate-200 placeholder:text-slate-600"
      />
    ) : (
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30 transition-all text-slate-200 placeholder:text-slate-600"
      />
    )}
  </div>
);

export default function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.GLOBALS);
  const [level, setLevel] = useState<DetailLevel>(DetailLevel.SIMPLE);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // --- Session State ---
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionName, setCurrentSessionName] = useState('Untitled Session');

  // --- AI State ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [activeRefImage, setActiveRefImage] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
    checkKey();
  }, [chatMessages, isTyping]);

  // Load sessions from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem('mythos_forge_sessions');
    if (saved) {
      try {
        setSessions(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse sessions", e);
      }
    }
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
        mode,
        globalData,
        charData,
        envData,
        propData,
        storyData,
        savedElements,
        chatMessages
      }
    };

    // Check if session with same name exists, update it, otherwise create new
    const existingIndex = sessions.findIndex(s => s.name === sessionData.name);
    let newSessions;
    if (existingIndex >= 0) {
       newSessions = [...sessions];
       newSessions[existingIndex] = sessionData;
    } else {
       newSessions = [...sessions, sessionData];
    }
    saveSessionsToStorage(newSessions);
    alert('Session saved successfully!');
  };

  const handleLoadSession = (session: Session) => {
    if (window.confirm(`Load session "${session.name}"? Unsaved changes will be lost.`)) {
      setMode(session.data.mode);
      setGlobalData(session.data.globalData);
      setCharData(session.data.charData);
      setEnvData(session.data.envData);
      setPropData(session.data.propData);
      setStoryData(session.data.storyData);
      setSavedElements(session.data.savedElements);
      setChatMessages(session.data.chatMessages);
      setCurrentSessionName(session.name);
      setIsSessionMenuOpen(false);
    }
  };

  const handleDeleteSession = (id: string) => {
    if (window.confirm("Are you sure you want to delete this session?")) {
      const newSessions = sessions.filter(s => s.id !== id);
      saveSessionsToStorage(newSessions);
    }
  };

  const handleNewSession = () => {
     if (window.confirm("Start a new session? Unsaved changes will be lost.")) {
         // Reset all states
         setGlobalData(initialGlobalData);
         setCharData(initialCharData);
         setEnvData(initialEnvData);
         setPropData(initialPropData);
         setStoryData({ synopsis: '', fullStory: '', storyScenes: [] });
         setSavedElements([]);
         setChatMessages([]);
         setCurrentSessionName('Untitled Session');
         setMode(AppMode.GLOBALS);
         setIsSessionMenuOpen(false);
     }
  };

  const checkKey = async () => {
    if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
      setHasKey(true);
    }
  };

  const handleOpenKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  // Initial Data Objects
  const initialGlobalData: GlobalData = { 
    style: '', 
    timePeriod: '', 
    genre: '', 
    lightingTheme: '', 
    colorPalette: '', 
    customApiKey: '',
    aspectRatio: '1:1',
    imageQuality: '1K',
    styleReferenceImages: [],
    googleSheetUrl: '',
    googleClientId: ''
  };
  
  const initialCharData: CharacterData = { 
    name: '', species: '', age: '', role: '', archetype: '', physicalDescription: '', personality: '', motivation: '', flaws: '', backstory: '', speechPatterns: '', secrets: '', visualStyle: '', keyActions: '', hairColor: '', eyeColor: '', height: '', build: '', distinguishingFeatures: '',
    skinTone: '', tattoosMarkings: '', clothingStyle: '', postureGait: '', scent: '', alignment: '', phobias: '', hobbies: '', intelligence: '', placeOfBirth: '', socialClass: '', beliefs: '', languages: '', signatureWeapon: '', specialAbilities: '', combatStyle: '', reputation: '', allies: '', enemies: '', petCompanion: '',
    voiceProfile: 'Puck', voiceDescription: ''
  };

  const initialEnvData: EnvironmentData = { name: '', biome: '', timeOfDay: '', weather: '', atmosphere: '', architecture: '', landmarks: '', history: '', lighting: '', visualStyle: '', scale: '', colors: '' };
  const initialPropData: PropData = { name: '', category: '', material: '', size: '', weight: '', condition: '', origin: '', properties: '', visualDetails: '', history: '', visualStyle: '' };

  // States for categories
  const [globalData, setGlobalData] = useState<GlobalData>(initialGlobalData);
  const [charData, setCharData] = useState<CharacterData>(initialCharData);
  const [envData, setEnvData] = useState<EnvironmentData>(initialEnvData);
  const [propData, setPropData] = useState<PropData>(initialPropData);

  // Story Data State
  const [storyData, setStoryData] = useState<StoryData>({ synopsis: '', fullStory: '', storyScenes: [] });
  const [savedElements, setSavedElements] = useState<SavedElement[]>([]);

  const handleSaveElement = (type: AppMode, name: string, desc: string, imageUrl: string) => {
    const newElement: SavedElement = {
      id: Date.now().toString(),
      type,
      name,
      description: desc,
      imageUrl
    };
    setSavedElements(prev => [...prev, newElement]);
  };

  const breakDownStory = () => {
      if (!storyData.fullStory) return;
      // Simple logic to chop text by double newlines or if short, single newlines
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
      // Updated to randomize ALL fields
      setCharData({
        ...charData,
        name: r.names[Math.floor(Math.random() * r.names.length)],
        species: r.species[Math.floor(Math.random() * r.species.length)],
        age: `${Math.floor(Math.random() * 80) + 18}`,
        role: r.roles[Math.floor(Math.random() * r.roles.length)],
        archetype: r.archetypes[Math.floor(Math.random() * r.archetypes.length)],
        voiceProfile: r.voices[Math.floor(Math.random() * r.voices.length)],
        voiceDescription: r.voiceDescriptions[Math.floor(Math.random() * r.voiceDescriptions.length)],
        
        // Physical
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

        // Psyche
        alignment: r.alignments[Math.floor(Math.random() * r.alignments.length)],
        intelligence: r.intelligences[Math.floor(Math.random() * r.intelligences.length)],
        motivation: r.motivations[Math.floor(Math.random() * r.motivations.length)],
        flaws: r.flaws[Math.floor(Math.random() * r.flaws.length)],
        personality: r.personalityTraits[Math.floor(Math.random() * r.personalityTraits.length)],
        phobias: r.phobias[Math.floor(Math.random() * r.phobias.length)],
        hobbies: r.hobbies[Math.floor(Math.random() * r.hobbies.length)],

        // Lore (Intermediate)
        placeOfBirth: r.places[Math.floor(Math.random() * r.places.length)],
        socialClass: r.socialClasses[Math.floor(Math.random() * r.socialClasses.length)],
        beliefs: r.beliefs[Math.floor(Math.random() * r.beliefs.length)],
        languages: r.languages[Math.floor(Math.random() * r.languages.length)],
        reputation: r.reputations[Math.floor(Math.random() * r.reputations.length)],
        allies: r.allies[Math.floor(Math.random() * r.allies.length)],
        enemies: r.enemies[Math.floor(Math.random() * r.enemies.length)],
        backstory: r.backstories[Math.floor(Math.random() * r.backstories.length)],
        secrets: r.secrets[Math.floor(Math.random() * r.secrets.length)],

        // Combat (Complex)
        signatureWeapon: r.weapons[Math.floor(Math.random() * r.weapons.length)],
        combatStyle: r.combatStyles[Math.floor(Math.random() * r.combatStyles.length)],
        specialAbilities: r.abilities[Math.floor(Math.random() * r.abilities.length)],
        petCompanion: r.pets[Math.floor(Math.random() * r.pets.length)],
        
        visualStyle: r.visualStyles[Math.floor(Math.random() * r.visualStyles.length)],
      });
    } else if (mode === AppMode.ENVIRONMENT) {
      setEnvData({
        ...envData,
        name: "Forbidden Sanctum",
        biome: r.biomes[Math.floor(Math.random() * r.biomes.length)],
        timeOfDay: r.times[Math.floor(Math.random() * r.times.length)],
        weather: r.weathers[Math.floor(Math.random() * r.weathers.length)],
        atmosphere: r.atmospheres[Math.floor(Math.random() * r.atmospheres.length)],
        architecture: r.architectures[Math.floor(Math.random() * r.architectures.length)],
        lighting: r.lightingThemes[Math.floor(Math.random() * r.lightingThemes.length)],
        visualStyle: r.visualStyles[Math.floor(Math.random() * r.visualStyles.length)],
        scale: "Colossal",
        landmarks: "A monolith reaching for the stars",
        history: "A site of forgotten rituals",
        colors: "Amber and Dark Graphite"
      });
    } else if (mode === AppMode.PROP) {
      setPropData({
        ...propData,
        name: "Pulse Blade",
        category: r.propCategories[Math.floor(Math.random() * r.propCategories.length)],
        material: r.materials[Math.floor(Math.random() * r.materials.length)],
        condition: r.conditions[Math.floor(Math.random() * r.conditions.length)],
        properties: r.properties[Math.floor(Math.random() * r.properties.length)],
        size: "Portable",
        weight: "Varies",
        origin: "The Deep Core",
        visualDetails: "Geometric fractals appearing and disappearing",
        history: "A remnant of a lost civilization",
        visualStyle: r.visualStyles[Math.floor(Math.random() * r.visualStyles.length)]
      });
    } else if (mode === AppMode.STORY) {
      setStoryData({
        ...storyData,
        synopsis: "A lone survivor discovers a signal from a lost colony, only to realize the colony isn't what it seems.",
        storyScenes: []
      });
    }
  };

  const applyGlobals = () => {
    if (mode === AppMode.CHARACTER) {
      setCharData(prev => ({ ...prev, visualStyle: globalData.style || prev.visualStyle, backstory: globalData.timePeriod ? `Originating from the ${globalData.timePeriod}. ${prev.backstory}` : prev.backstory }));
    } else if (mode === AppMode.ENVIRONMENT) {
      setEnvData(prev => ({ ...prev, visualStyle: globalData.style || prev.visualStyle, lighting: globalData.lightingTheme || prev.lighting, architecture: globalData.timePeriod ? `${globalData.timePeriod} era structures` : prev.architecture, colors: globalData.colorPalette || prev.colors }));
    } else if (mode === AppMode.PROP) {
      setPropData(prev => ({ ...prev, visualStyle: globalData.style || prev.visualStyle, origin: globalData.timePeriod ? `Forged during the ${globalData.timePeriod}` : prev.origin }));
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
      
      if (files.length > remainingSlots) {
        alert(`Maximum 9 style reference images allowed. You can only upload ${remainingSlots} more.`);
        return;
      }

      files.slice(0, remainingSlots).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setGlobalData(prev => ({
            ...prev,
            styleReferenceImages: [...prev.styleReferenceImages, reader.result as string]
          }));
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeStyleImage = (index: number) => {
    setGlobalData(prev => ({
      ...prev,
      styleReferenceImages: prev.styleReferenceImages.filter((_, i) => i !== index)
    }));
  };

  const getApiKey = () => {
    // Priority: Custom Key > Environment Key
    const k = globalData.customApiKey?.trim() || process.env.API_KEY;
    return k?.trim();
  };

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
         // Gather context from saved elements
         const context = savedElements.map(el => `[Saved ${el.type}]: ${el.name} - ${el.description}`).join('\n');
         contents = [
           { parts: [{ text: PROMPT_TEMPLATES.storyGen(text, context) }], role: 'user' }
         ];
      } else {
         contents = [
          ...chatMessages.map(m => ({ parts: [{ text: m.text }], role: m.role })),
          { parts: [{ text }], role: 'user' }
        ];
      }

      const stream = await ai.models.generateContentStream({
        model: 'gemini-3-pro-preview',
        contents
      });

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
      
      if (isStoryGen) {
        setStoryData(prev => ({ ...prev, fullStory: fullText }));
        // Optionally auto-breakdown here if desired, but button is safer
      }

    } catch (error: any) {
      console.error(error);
      const msg = error.message || "Unknown API Error";
      setChatMessages(prev => [...prev, { role: 'model', text: `Error: ${msg}. Check API Key permissions.` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const generateVoice = async (textToSpeak: string) => {
    const apiKey = getApiKey();
    if (!hasKey && !apiKey) {
      await handleOpenKey();
      return;
    }
    
    // Determine what to speak: Provided text OR default character intro
    const spokenText = textToSpeak || `${charData.name}, ${charData.archetype}. ${charData.personality}. ${charData.backstory.substring(0, 100)}`;
    
    setIsChatOpen(true);
    setChatMessages(prev => [...prev, { role: 'user', text: `Generate Voice for ${charData.name || 'Character'} (${charData.voiceProfile})` }]);
    setIsTyping(true);
    setGenStatus(`Synthesizing voice using ${charData.voiceProfile}...`);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: { parts: [{ text: spokenText }] },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: charData.voiceProfile }
            }
          }
        }
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (base64Audio) {
        // Automatically play
        await playAudio(base64Audio);
        setChatMessages(prev => [...prev, { 
          role: 'model', 
          text: `"${spokenText.substring(0, 50)}..."`, 
          audioData: base64Audio 
        }]);
      } else {
        throw new Error("No audio data returned");
      }

    } catch (error: any) {
      console.error(error);
      const msg = error.message || "Unknown Voice Error";
      setChatMessages(prev => [...prev, { role: 'model', text: `Voice Failed: ${msg}` }]);
    } finally {
      setIsTyping(false);
      setGenStatus('');
    }
  };

  const generateImage = async (promptText: string, isStoryboard = false) => {
    const apiKey = getApiKey();
    if (!hasKey && !apiKey) {
      await handleOpenKey();
      return;
    }

    setIsChatOpen(true);
    const userPrompt = activeRefImage 
      ? `Generate Visual with consistency: ${promptText.substring(0, 50)}...` 
      : isStoryboard ? `Generate Storyboard: ${promptText.substring(0, 50)}...` : `Generate New Visual: ${promptText.substring(0, 50)}...`;
      
    setChatMessages(prev => [...prev, { role: 'user', text: userPrompt }]);
    setIsTyping(true);
    setGenStatus(activeRefImage ? 'Maintaining character consistency...' : 'Analyzing visual tokens...');

    const statusSteps = activeRefImage 
      ? ['Anchoring to reference image...', 'Synchronizing facial features...', 'Matching color palette...', 'Synthesizing consistent textures...', 'Finalizing Pro-render...']
      : ['Deconstructing narrative prompt...', 'Synthesizing geometric primitives...', 'Injecting atmospheric lighting...', 'Scaling textures to Pro-resolution...', 'Finalizing render pass...'];

    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex < statusSteps.length) {
        setGenStatus(statusSteps[stepIndex]);
        stepIndex++;
      }
    }, 1500);

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const contents: any = { parts: [] };
      let promptPrefix = "";
      let referenceBase64: string | undefined;
      
      // 1. Add Style Reference Images (if any)
      if (globalData.styleReferenceImages.length > 0) {
        globalData.styleReferenceImages.forEach(imgData => {
           const base64 = imgData.split(',')[1];
           const mimeType = imgData.split(';')[0].split(':')[1];
           contents.parts.push({
             inlineData: {
               data: base64,
               mimeType: mimeType
             }
           });
        });
        promptPrefix += ` STYLE REFERENCE: Use the provided ${globalData.styleReferenceImages.length} images as the strict visual style guide (color palette, lighting, rendering technique).`;
      }

      // 2. Character Consistency Logic: Find last generated image and use as reference
      // OR if Storyboard mode, find referenced characters in the prompt
      if (isStoryboard) {
          // Check if any saved character names are in the prompt
          savedElements.forEach(el => {
              if (el.type === AppMode.CHARACTER && promptText.includes(el.name)) {
                   const base64 = el.imageUrl.split(',')[1];
                   contents.parts.push({
                     inlineData: {
                       data: base64,
                       mimeType: 'image/png'
                     }
                   });
                   promptPrefix += ` CHARACTER REFERENCE: ${el.name} is depicted in the attached image. Maintain their likeness in the storyboard panels. `;
              }
          });
      } else {
          const lastImageMsg = [...chatMessages].reverse().find(m => m.image);
          referenceBase64 = lastImageMsg?.image?.split(',')[1];

          if (referenceBase64) {
            contents.parts.push({
              inlineData: {
                data: referenceBase64,
                mimeType: 'image/png'
              }
            });
            promptPrefix += ` SUBJECT REFERENCE: Use the last image as the definitive character structure/features. Ensure the person/character is the exact same one as in the reference.`;
          }
      }

      // 3. Add Prompt Text
      const finalPrompt = isStoryboard 
        ? `${promptPrefix} ${PROMPT_TEMPLATES.storyboardGen(promptText)}` 
        : `${promptPrefix} ${referenceBase64 ? 'STRICT CHARACTER CONSISTENCY REQUIRED.' : ''} Professional Concept Art: ${promptText}. Cinematic lighting, extreme detail, masterpiece, 8k, ${globalData.style}.`;

      contents.parts.push({
        text: finalPrompt
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents,
        config: { 
          imageConfig: { 
            aspectRatio: isStoryboard ? "4:3" : globalData.aspectRatio, 
            imageSize: globalData.imageQuality 
          } 
        }
      });

      let imageUrl = '';
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      clearInterval(interval);
      if (imageUrl) {
        setChatMessages(prev => [...prev, { 
            role: 'model', 
            text: isStoryboard ? `Storyboard generated for: "${promptText.substring(0,30)}..."` : (referenceBase64 ? 'Character successfully evolved while maintaining consistency.' : `Visualized your concept at ${globalData.imageQuality} resolution.`), 
            image: imageUrl,
            isStoryboard
        }]);
        if (!isStoryboard) {
            setActiveRefImage(imageUrl);
        }
      } else {
        throw new Error("Empty image payload");
      }
    } catch (error: any) {
      clearInterval(interval);
      console.error(error);
      const msg = error.message || "Visual Generation Error";
      setChatMessages(prev => [...prev, { role: 'model', text: `Visual Failed: ${msg}. Check API Key permissions or try a simpler prompt.` }]);
    } finally {
      setIsTyping(false);
      setGenStatus('');
    }
  };

  const getActivePrompts = () => {
    switch (mode) {
      case AppMode.CHARACTER:
        return [
          { title: 'Narrative Profile', icon: 'fa-book-open', content: PROMPT_TEMPLATES.characterNarrative(charData) },
          { title: 'Visual Description', icon: 'fa-camera', content: PROMPT_TEMPLATES.characterVisual(charData) },
          { title: 'Multi-View Concept', icon: 'fa-layer-group', content: PROMPT_TEMPLATES.characterMultiView(charData) }
        ];
      case AppMode.ENVIRONMENT:
        return [
          { title: 'Cinematic Atmosphere', icon: 'fa-clapperboard', content: PROMPT_TEMPLATES.envCinematic(envData) },
          { title: 'World Lore', icon: 'fa-globe', content: PROMPT_TEMPLATES.envWorldbuilding(envData) },
          { title: 'Concept Canvas', icon: 'fa-paintbrush', content: PROMPT_TEMPLATES.envConcept(envData) }
        ];
      case AppMode.PROP:
        return [
          { title: 'Technical Spec', icon: 'fa-microscope', content: PROMPT_TEMPLATES.propDescription(propData) },
          { title: 'Mythic Relic', icon: 'fa-crown', content: PROMPT_TEMPLATES.propRelic(propData) },
          { title: 'Industrial Design', icon: 'fa-pen-ruler', content: PROMPT_TEMPLATES.propDesign(propData) }
        ];
      default:
        return [];
    }
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim()) {
      sendToAI(chatInput);
    }
  };

  // --- Google Sheets Integration ---

  const extractSpreadsheetId = (url: string) => {
    const matches = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return matches ? matches[1] : null;
  };

  const syncToSheets = () => {
    if (!globalData.googleClientId || !globalData.googleSheetUrl) {
      alert("Please provide both a Client ID and a Google Sheet URL.");
      return;
    }

    const spreadsheetId = extractSpreadsheetId(globalData.googleSheetUrl);
    if (!spreadsheetId) {
      alert("Invalid Google Sheet URL. Could not extract Spreadsheet ID.");
      return;
    }

    if (!window.google) {
      alert("Google Identity Services script not loaded. Please refresh.");
      return;
    }

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: globalData.googleClientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      callback: async (tokenResponse: any) => {
        if (tokenResponse && tokenResponse.access_token) {
          try {
            await performSheetUpdate(tokenResponse.access_token, spreadsheetId);
            alert("Session successfully synced to Google Sheets!");
            setIsExportMenuOpen(false);
          } catch (e: any) {
            console.error(e);
            alert(`Error syncing to Sheets: ${e.message}`);
          }
        }
      },
    });

    client.requestAccessToken();
  };

  const performSheetUpdate = async (accessToken: string, spreadsheetId: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sheetPrefix = `Export_${timestamp.substring(0, 19)}`;

    // Prepare Data
    const charRows = Object.entries(charData).map(([k, v]) => [k, v]);
    const envRows = Object.entries(envData).map(([k, v]) => [k, v]);
    const storyRows = [['Synopsis', storyData.synopsis], ['Full Story', storyData.fullStory], ...storyData.storyScenes.map((s, i) => [`Scene ${i+1}`, s])];
    const registryRows = [['Type', 'Name', 'Description'], ...savedElements.map(e => [e.type, e.name, e.description])];
    const chatRows = [['Role', 'Message'], ...chatMessages.map(m => [m.role, m.text])];

    // 1. Create Tabs
    const sheetTitles = ['Character', 'World', 'Story', 'Registry', 'Chat'];
    const addSheetRequests = sheetTitles.map(title => ({
      addSheet: {
        properties: {
          title: `${sheetPrefix}_${title}`
        }
      }
    }));

    const createResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: addSheetRequests })
    });
    
    if(!createResp.ok) throw new Error("Failed to create new sheets. Ensure the sheet is editable by you.");
    const createData = await createResp.json();

    // 2. Write Data
    const valueData: any[] = [];
    
    // Helper to find ID by title from response
    const getSheetId = (titlePart: string) => {
        const title = `${sheetPrefix}_${titlePart}`;
        // Simple write doesn't need ID if we use range 'Title!A1'
        return title;
    };

    valueData.push({ range: `${getSheetId('Character')}!A1`, values: [['KEY', 'VALUE'], ...charRows] });
    valueData.push({ range: `${getSheetId('World')}!A1`, values: [['KEY', 'VALUE'], ...envRows] });
    valueData.push({ range: `${getSheetId('Story')}!A1`, values: [['SECTION', 'CONTENT'], ...storyRows] });
    valueData.push({ range: `${getSheetId('Registry')}!A1`, values: registryRows });
    valueData.push({ range: `${getSheetId('Chat')}!A1`, values: chatRows });

    const writeResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: valueData
      })
    });

    if(!writeResp.ok) throw new Error("Failed to write data to sheets.");
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200 pb-64 relative overflow-hidden">
      <Header onOpenSessions={() => setIsSessionMenuOpen(true)} onOpenExport={() => setIsExportMenuOpen(true)} />

      {/* Mode Navigation */}
      <div className="bg-slate-900/30 border-b border-slate-800 px-8 py-4 sticky top-20 z-40 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex gap-4 overflow-x-auto pb-1">
          {[AppMode.GLOBALS, AppMode.CHARACTER, AppMode.ENVIRONMENT, AppMode.PROP, AppMode.STORY].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                mode === m ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <i className={`fa-solid ${m === AppMode.GLOBALS ? 'fa-sliders' : m === AppMode.CHARACTER ? 'fa-user' : m === AppMode.ENVIRONMENT ? 'fa-mountain' : m === AppMode.STORY ? 'fa-book-skull' : 'fa-cube'}`}></i>
              {/* Correct pluralization: Globals remains Globals, others get 's' (Story -> Stories is handled roughly or allowed as 'Storys' per current logic, let's fix) */}
              {m === AppMode.GLOBALS ? m : m === AppMode.STORY ? 'Stories' : `${m}s`}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">
        
        {/* Detail Level Controls */}
        <div className="flex flex-col md:flex-row gap-6 items-center justify-between mb-10">
          <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            {Object.values(DetailLevel).map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`px-4 py-2 text-xs font-semibold rounded-md transition-all ${
                  level === l ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {mode !== AppMode.GLOBALS && (
              <button onClick={applyGlobals} className="flex items-center gap-2 px-6 py-2.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 rounded-full text-sm font-semibold transition-all">
                <i className="fa-solid fa-wand-sparkles"></i>
                Autofill Pro-Common
              </button>
            )}
            <button onClick={randomize} className="flex items-center gap-2 px-6 py-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 rounded-full text-sm font-semibold transition-all group">
              <i className="fa-solid fa-dice transition-transform group-hover:rotate-45"></i>
              Chaos Seed
            </button>
          </div>
        </div>

        {/* Form Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {mode === AppMode.GLOBALS && (
            <>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Aesthetic Engine" icon="fa-palette" />
                <InputField label="Visual Style" value={globalData.style} onChange={(v) => setGlobalData({...globalData, style: v})} placeholder="E.g. Dark Fantasy Noir" />
                <InputField label="Time Period" value={globalData.timePeriod} onChange={(v) => setGlobalData({...globalData, timePeriod: v})} />
                <InputField label="Primary Genre" value={globalData.genre} onChange={(v) => setGlobalData({...globalData, genre: v})} />
              </section>
              
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Style Guide (Max 9)" icon="fa-images" />
                <div className="flex flex-col gap-4">
                  <div className="relative group">
                    <input 
                      type="file" 
                      accept="image/*" 
                      multiple 
                      onChange={handleStyleImageUpload} 
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                      disabled={globalData.styleReferenceImages.length >= 9}
                    />
                    <div className="border-2 border-dashed border-slate-700 rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-slate-500 group-hover:border-yellow-500/50 group-hover:text-yellow-500 transition-colors bg-slate-800/50">
                      <i className="fa-solid fa-cloud-arrow-up text-2xl"></i>
                      <span className="text-xs font-bold uppercase tracking-widest">Upload References</span>
                    </div>
                  </div>
                  
                  {globalData.styleReferenceImages.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {globalData.styleReferenceImages.map((img, idx) => (
                        <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-700 group">
                          <img src={img} alt={`Ref ${idx}`} className="w-full h-full object-cover" />
                          <button 
                            onClick={() => removeStyleImage(idx)} 
                            className="absolute top-1 right-1 w-5 h-5 bg-red-500/80 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between items-center text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                    <span>Active Refs</span>
                    <span className={globalData.styleReferenceImages.length === 9 ? 'text-red-500' : 'text-slate-400'}>{globalData.styleReferenceImages.length} / 9</span>
                  </div>
                </div>
              </section>

              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="AI & Render Config" icon="fa-gear" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-400">Aspect Ratio</label>
                    <select 
                      value={globalData.aspectRatio} 
                      onChange={(e) => setGlobalData({...globalData, aspectRatio: e.target.value as any})}
                      className="bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-yellow-500/30"
                    >
                      <option value="1:1">Square (1:1)</option>
                      <option value="16:9">Widescreen (16:9)</option>
                      <option value="9:16">Portrait (9:16)</option>
                      <option value="4:3">Standard (4:3)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-400">Target Quality</label>
                    <select 
                      value={globalData.imageQuality} 
                      onChange={(e) => setGlobalData({...globalData, imageQuality: e.target.value as any})}
                      className="bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-yellow-500/30"
                    >
                      <option value="1K">1K High-Fi</option>
                      <option value="2K">2K Ultra-Fi</option>
                    </select>
                  </div>
                </div>
                <InputField label="Custom Google AI API Key (Optional)" type="password" value={globalData.customApiKey || ''} onChange={(v) => setGlobalData({...globalData, customApiKey: v})} placeholder="Allows custom quota usage..." />
              </section>
            </>
          )}

          {mode === AppMode.CHARACTER && (
            <>
              {/* CORE IDENTITY */}
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Core Essence" icon="fa-dna" />
                <InputField label="Full Name" value={charData.name} onChange={(v) => setCharData({...charData, name: v})} />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Species" value={charData.species} onChange={(v) => setCharData({...charData, species: v})} />
                  <InputField label="Age" value={charData.age} onChange={(v) => setCharData({...charData, age: v})} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Narrative Role" value={charData.role} onChange={(v) => setCharData({...charData, role: v})} />
                  <InputField label="Archetype" value={charData.archetype} onChange={(v) => setCharData({...charData, archetype: v})} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-400">Voice Profile (TTS Consistency)</label>
                  <select 
                    value={charData.voiceProfile} 
                    onChange={(e) => setCharData({...charData, voiceProfile: e.target.value})}
                    className="bg-slate-800 border border-slate-700 rounded-md px-2 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-yellow-500/30"
                  >
                    <option value="Puck">Puck (Male, Tenor, Playful)</option>
                    <option value="Charon">Charon (Male, Deep, Serious)</option>
                    <option value="Kore">Kore (Female, Alto, Calm)</option>
                    <option value="Fenrir">Fenrir (Male, Bass, Intense)</option>
                    <option value="Zephyr">Zephyr (Female, Soprano, Light)</option>
                  </select>
                </div>
                <InputField label="Voice Description" value={charData.voiceDescription} onChange={(v) => setCharData({...charData, voiceDescription: v})} placeholder="E.g. Raspy, whispering, manic..." />
              </section>

              {/* PHYSICAL APPEARANCE */}
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Physicality" icon="fa-person-rays" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Height" value={charData.height} onChange={(v) => setCharData({...charData, height: v})} />
                  <InputField label="Build" value={charData.build} onChange={(v) => setCharData({...charData, build: v})} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Hair Color" value={charData.hairColor} onChange={(v) => setCharData({...charData, hairColor: v})} />
                  <InputField label="Eye Color" value={charData.eyeColor} onChange={(v) => setCharData({...charData, eyeColor: v})} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Skin Tone" value={charData.skinTone} onChange={(v) => setCharData({...charData, skinTone: v})} />
                  <InputField label="Scent" value={charData.scent} onChange={(v) => setCharData({...charData, scent: v})} />
                </div>
                <InputField label="Distinguishing Features" value={charData.distinguishingFeatures} onChange={(v) => setCharData({...charData, distinguishingFeatures: v})} />
                <InputField label="Tattoos / Markings" value={charData.tattoosMarkings} onChange={(v) => setCharData({...charData, tattoosMarkings: v})} />
                <InputField label="Posture / Gait" value={charData.postureGait} onChange={(v) => setCharData({...charData, postureGait: v})} />
                <InputField label="Clothing Style" value={charData.clothingStyle} onChange={(v) => setCharData({...charData, clothingStyle: v})} />
              </section>

              {/* PSYCHOLOGY & PERSONALITY */}
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
                <SectionTitle title="Psyche" icon="fa-brain" />
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Alignment" value={charData.alignment} onChange={(v) => setCharData({...charData, alignment: v})} />
                  <InputField label="Intelligence" value={charData.intelligence} onChange={(v) => setCharData({...charData, intelligence: v})} />
                </div>
                <InputField label="Motivation" value={charData.motivation} onChange={(v) => setCharData({...charData, motivation: v})} />
                <InputField label="Flaws" value={charData.flaws} onChange={(v) => setCharData({...charData, flaws: v})} />
                <InputField label="Personality Matrix" value={charData.personality} onChange={(v) => setCharData({...charData, personality: v})} isTextArea />
                <InputField label="Phobias" value={charData.phobias} onChange={(v) => setCharData({...charData, phobias: v})} />
                <InputField label="Hobbies / Interests" value={charData.hobbies} onChange={(v) => setCharData({...charData, hobbies: v})} />
              </section>

              {/* LORE & SOCIAL */}
              {(level !== DetailLevel.SIMPLE) && (
                <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4 animate-in fade-in slide-in-from-bottom-2">
                  <SectionTitle title="Lore & Social" icon="fa-scroll" />
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="Birthplace" value={charData.placeOfBirth} onChange={(v) => setCharData({...charData, placeOfBirth: v})} />
                    <InputField label="Social Class" value={charData.socialClass} onChange={(v) => setCharData({...charData, socialClass: v})} />
                  </div>
                  <InputField label="Beliefs / Religion" value={charData.beliefs} onChange={(v) => setCharData({...charData, beliefs: v})} />
                  <InputField label="Languages" value={charData.languages} onChange={(v) => setCharData({...charData, languages: v})} />
                  <InputField label="Reputation" value={charData.reputation} onChange={(v) => setCharData({...charData, reputation: v})} />
                  <InputField label="Allies" value={charData.allies} onChange={(v) => setCharData({...charData, allies: v})} />
                  <InputField label="Enemies" value={charData.enemies} onChange={(v) => setCharData({...charData, enemies: v})} />
                  <InputField label="Backstory" value={charData.backstory} onChange={(v) => setCharData({...charData, backstory: v})} isTextArea />
                  <InputField label="Secrets" value={charData.secrets} onChange={(v) => setCharData({...charData, secrets: v})} />
                </section>
              )}

              {/* COMBAT & COMPANIONS */}
              {(level === DetailLevel.COMPLEX) && (
                <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                  <SectionTitle title="Abilities & Companion" icon="fa-khanda" />
                  <InputField label="Signature Weapon" value={charData.signatureWeapon} onChange={(v) => setCharData({...charData, signatureWeapon: v})} />
                  <InputField label="Combat Style" value={charData.combatStyle} onChange={(v) => setCharData({...charData, combatStyle: v})} />
                  <InputField label="Special Abilities" value={charData.specialAbilities} onChange={(v) => setCharData({...charData, specialAbilities: v})} isTextArea />
                  <InputField label="Pet / Companion" value={charData.petCompanion} onChange={(v) => setCharData({...charData, petCompanion: v})} />
                </section>
              )}
            </>
          )}

          {mode === AppMode.ENVIRONMENT && (
            <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
              <SectionTitle title="The Locale" icon="fa-mountain-city" />
              <InputField label="Location Name" value={envData.name} onChange={(v) => setEnvData({...envData, name: v})} />
              <InputField label="Biome Type" value={envData.biome} onChange={(v) => setEnvData({...envData, biome: v})} />
              <InputField label="Current Atmosphere" value={envData.atmosphere} onChange={(v) => setEnvData({...envData, atmosphere: v})} />
            </section>
          )}

          {mode === AppMode.PROP && (
            <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4">
              <SectionTitle title="Object Definition" icon="fa-box" />
              <InputField label="Item Name" value={propData.name} onChange={(v) => setPropData({...propData, name: v})} />
              <InputField label="Composition" value={propData.material} onChange={(v) => setPropData({...propData, material: v})} />
              <InputField label="Artifact Properties" value={propData.properties} onChange={(v) => setPropData({...propData, properties: v})} isTextArea />
            </section>
          )}

          {mode === AppMode.STORY && (
            <>
              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4 col-span-1 lg:col-span-2">
                <SectionTitle title="Story Studio" icon="fa-pen-nib" />
                <InputField 
                  label="Synopsis / Prompt" 
                  value={storyData.synopsis} 
                  onChange={(v) => setStoryData({...storyData, synopsis: v})} 
                  isTextArea 
                  placeholder="Describe the plot or scene..." 
                />
                <button 
                  onClick={() => sendToAI(storyData.synopsis, true)}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold text-white transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
                >
                  <i className="fa-solid fa-wand-magic-sparkles"></i>
                  Generate Story Text
                </button>
                <div className="relative">
                   <InputField 
                    label="Full Story" 
                    value={storyData.fullStory} 
                    onChange={(v) => setStoryData({...storyData, fullStory: v})} 
                    isTextArea 
                  />
                  <div className="absolute bottom-3 right-3 flex gap-2">
                    <button 
                       onClick={() => copyToClipboard(storyData.fullStory, 999)} 
                       className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white"
                    >
                      <i className="fa-solid fa-copy"></i>
                    </button>
                    {storyData.fullStory && (
                        <button 
                            onClick={breakDownStory}
                            className="p-2 bg-yellow-600 hover:bg-yellow-500 rounded text-xs text-white flex items-center gap-1"
                            title="Chop text into scenes"
                        >
                            <i className="fa-solid fa-scissors"></i>
                        </button>
                    )}
                  </div>
                </div>
                
                {storyData.storyScenes.length > 0 && (
                   <div className="pt-4 border-t border-slate-800">
                      <SectionTitle title="Storyboard Scenes" icon="fa-film" />
                      <div className="space-y-6">
                        {storyData.storyScenes.map((scene, idx) => (
                          <div key={idx} className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                             <div className="flex justify-between items-center mb-2">
                               <span className="text-xs font-bold text-yellow-500 uppercase tracking-widest">Page {idx + 1}</span>
                             </div>
                             <textarea 
                                value={scene}
                                onChange={(e) => updateSceneText(idx, e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mb-3"
                                rows={3}
                             />
                             <button 
                                onClick={() => generateImage(scene, true)}
                                className="w-full py-2 bg-slate-700 hover:bg-yellow-500 hover:text-slate-900 text-slate-300 font-bold rounded-lg transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wide"
                             >
                               <i className="fa-solid fa-camera"></i>
                               Visualize Page {idx + 1}
                             </button>
                          </div>
                        ))}
                      </div>
                   </div>
                )}
                
                <div className="pt-4 border-t border-slate-800">
                    <SectionTitle title="Quick Visual" icon="fa-bolt" />
                    <div className="flex flex-col gap-2">
                        <textarea 
                           className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30 transition-all resize-none text-slate-200"
                           rows={2}
                           placeholder="Type a custom scene description..."
                           id="storyboard-input"
                        />
                        <button 
                          onClick={() => {
                              const input = document.getElementById('storyboard-input') as HTMLTextAreaElement;
                              if(input && input.value) generateImage(input.value, true);
                          }}
                          className="w-full py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold text-slate-300 transition-all flex items-center justify-center gap-2"
                        >
                          <i className="fa-solid fa-paintbrush"></i>
                          Generate Custom 2x2
                        </button>
                    </div>
                </div>
              </section>

              <section className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-4 h-fit">
                <SectionTitle title="Context Registry" icon="fa-box-archive" />
                <div className="text-xs text-slate-400 mb-2">
                   Items saved here are automatically referenced by the AI during story and storyboard generation.
                </div>
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                   {savedElements.length === 0 && (
                       <div className="text-center py-8 text-slate-600 italic border border-dashed border-slate-800 rounded-lg">
                           No saved elements. Generate characters/props and click "Save to Registry" in the chat.
                       </div>
                   )}
                   {savedElements.map((el) => (
                       <div key={el.id} className="flex gap-3 bg-slate-800 p-2 rounded-lg border border-slate-700 group">
                           <div className="w-12 h-12 shrink-0 rounded bg-slate-700 overflow-hidden">
                               <img src={el.imageUrl} alt={el.name} className="w-full h-full object-cover" />
                           </div>
                           <div className="flex-1 min-w-0">
                               <div className="flex justify-between items-start">
                                   <h4 className="font-bold text-slate-200 text-sm truncate">{el.name}</h4>
                                   <span className="text-[10px] uppercase tracking-wider bg-slate-900 px-1.5 py-0.5 rounded text-slate-500">{el.type}</span>
                               </div>
                               <p className="text-[10px] text-slate-400 truncate">{el.description.substring(0, 40)}...</p>
                           </div>
                           <button 
                             onClick={() => setSavedElements(prev => prev.filter(x => x.id !== el.id))}
                             className="text-slate-600 hover:text-red-400 px-1"
                           >
                               <i className="fa-solid fa-trash"></i>
                           </button>
                       </div>
                   ))}
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {/* Floating Action Button */}
      <button onClick={() => setIsChatOpen(!isChatOpen)} className="fixed bottom-32 right-8 w-14 h-14 bg-yellow-500 hover:bg-yellow-400 text-slate-950 rounded-full shadow-2xl z-50 flex items-center justify-center transition-all hover:scale-110 active:scale-95 border-4 border-slate-900">
        <i className={`fa-solid ${isChatOpen ? 'fa-times' : 'fa-brain'} text-xl`}></i>
      </button>

      {/* Export / Sheets Manager Overlay */}
      {isExportMenuOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
             <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-green-900/20">
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 bg-green-600 rounded flex items-center justify-center text-white">
                     <i className="fa-solid fa-table"></i>
                   </div>
                   <h2 className="text-xl font-bold text-white">Export to Google Sheets</h2>
                </div>
                <button onClick={() => setIsExportMenuOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                  <i className="fa-solid fa-xmark text-xl"></i>
                </button>
             </div>
             
             <div className="p-6 space-y-4">
                <p className="text-sm text-slate-400">
                   Sync your current session data (Character, World, Story, Registry) to a new set of tabs in your Google Sheet.
                   <br/><br/>
                   <span className="text-yellow-500 font-bold">Requirement:</span> You must provide a Google Cloud Client ID enabled for the <em>Google Sheets API</em> to authorize this action.
                </p>

                <div className="space-y-3">
                    <InputField 
                       label="Google Cloud Client ID" 
                       value={globalData.googleClientId || ''} 
                       onChange={(v) => setGlobalData({...globalData, googleClientId: v})}
                       placeholder="e.g., 12345...apps.googleusercontent.com" 
                    />
                    <InputField 
                       label="Google Sheet URL" 
                       value={globalData.googleSheetUrl || ''} 
                       onChange={(v) => setGlobalData({...globalData, googleSheetUrl: v})}
                       placeholder="https://docs.google.com/spreadsheets/d/..." 
                    />
                </div>

                <div className="flex justify-end pt-4">
                    <button 
                       onClick={syncToSheets}
                       className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg shadow-lg shadow-green-600/20 flex items-center gap-2 transition-all"
                    >
                       <i className="fa-brands fa-google-drive"></i>
                       Authorize & Sync
                    </button>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Session Manager Overlay */}
      {isSessionMenuOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
             <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 bg-slate-800 rounded flex items-center justify-center text-yellow-500">
                     <i className="fa-solid fa-folder-open"></i>
                   </div>
                   <h2 className="text-xl font-bold text-white">Session Manager</h2>
                </div>
                <button onClick={() => setIsSessionMenuOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                  <i className="fa-solid fa-xmark text-xl"></i>
                </button>
             </div>
             
             <div className="p-6 border-b border-slate-800 space-y-4">
                <div className="flex gap-2">
                   <input 
                     type="text" 
                     value={currentSessionName} 
                     onChange={(e) => setCurrentSessionName(e.target.value)} 
                     className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                     placeholder="Name your session..."
                   />
                   <button 
                     onClick={handleSaveSession}
                     className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
                   >
                     <i className="fa-solid fa-save"></i>
                     Save
                   </button>
                   <button 
                     onClick={handleNewSession}
                     className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
                   >
                     <i className="fa-solid fa-plus"></i>
                     New
                   </button>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {sessions.length === 0 && (
                   <div className="text-center py-10 text-slate-500 italic">No saved sessions found.</div>
                )}
                {sessions.sort((a,b) => b.lastModified - a.lastModified).map(session => (
                   <div key={session.id} className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex justify-between items-center group hover:border-slate-600 transition-colors">
                      <div>
                         <h4 className="font-bold text-slate-200">{session.name}</h4>
                         <p className="text-xs text-slate-500">Last saved: {new Date(session.lastModified).toLocaleString()}</p>
                         <div className="flex gap-2 mt-1">
                             <span className="text-[10px] bg-slate-800 px-1.5 rounded text-slate-400">{session.data.savedElements.length} Assets</span>
                             <span className="text-[10px] bg-slate-800 px-1.5 rounded text-slate-400">{session.data.storyData.fullStory ? 'Has Story' : 'No Story'}</span>
                         </div>
                      </div>
                      <div className="flex gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                         <button 
                           onClick={() => handleLoadSession(session)}
                           className="w-8 h-8 rounded bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-colors"
                           title="Load"
                         >
                            <i className="fa-solid fa-upload"></i>
                         </button>
                         <button 
                           onClick={() => handleDeleteSession(session.id)}
                           className="w-8 h-8 rounded bg-red-600/20 hover:bg-red-600 text-red-500 hover:text-white flex items-center justify-center transition-colors"
                           title="Delete"
                         >
                            <i className="fa-solid fa-trash"></i>
                         </button>
                      </div>
                   </div>
                ))}
             </div>
          </div>
        </div>
      )}

      {/* Persistent Footer Cards */}
      {mode !== AppMode.GLOBALS && mode !== AppMode.STORY && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-yellow-500/20 shadow-2xl z-40 p-4 lg:p-6 overflow-x-auto">
          <div className="max-w-7xl mx-auto flex gap-6 min-w-max px-4">
            {getActivePrompts().map((p, idx) => (
              <div key={idx} className="flex-1 min-w-[360px] max-w-md bg-slate-950/50 rounded-xl border border-slate-800 p-4 group relative overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2 text-yellow-500 font-bold text-xs uppercase tracking-tighter">
                    <i className={`fa-solid ${p.icon}`}></i>
                    {p.title}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => generateImage(p.content)} className="px-2.5 py-1 bg-yellow-500/10 hover:bg-yellow-500/30 text-yellow-500 rounded text-[10px] font-black uppercase transition-all border border-yellow-500/30">
                      <i className="fa-solid fa-image mr-1"></i> Visual
                    </button>
                    {mode === AppMode.CHARACTER && (
                      <button onClick={() => generateVoice(p.content.substring(0, 200))} className="px-2.5 py-1 bg-pink-500/10 hover:bg-pink-500/30 text-pink-500 rounded text-[10px] font-black uppercase transition-all border border-pink-500/30">
                        <i className="fa-solid fa-microphone-lines mr-1"></i> Speak
                      </button>
                    )}
                    <button onClick={() => sendToAI(p.content)} className="px-2.5 py-1 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 rounded text-[10px] font-black uppercase transition-all border border-indigo-500/30">
                      <i className="fa-solid fa-message mr-1"></i> Refine
                    </button>
                    <button onClick={() => copyToClipboard(p.content, idx)} className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all ${copiedIndex === idx ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                      {copiedIndex === idx ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="flex-1 bg-slate-900/40 rounded p-3 mono text-[11px] leading-relaxed text-slate-400 overflow-y-auto max-h-36 border border-slate-800/50 italic select-all">
                  <pre className="whitespace-pre-wrap">{p.content}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pro Chat / Visual Panel */}
      <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-yellow-500 rounded flex items-center justify-center">
              <i className="fa-solid fa-bolt text-slate-950 text-sm"></i>
            </div>
            <span className="font-black text-yellow-500 uppercase tracking-tighter text-sm">Pro Studio</span>
          </div>
          <button onClick={() => setIsChatOpen(false)} className="text-slate-500 hover:text-white p-2 transition-colors"><i className="fa-solid fa-xmark text-xl"></i></button>
        </div>

        {!hasKey && (
          <div className="p-6 bg-yellow-500/10 border-b border-yellow-500/20 flex flex-col items-center text-center space-y-3">
            <i className="fa-solid fa-unlock-keyhole text-yellow-500 text-2xl"></i>
            <p className="text-xs text-slate-300">Advanced Visual Studio requires a paid project API key. Select yours to unlock Nanobanana Pro.</p>
            <button onClick={handleOpenKey} className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black rounded-full text-xs transition-all uppercase tracking-widest shadow-lg shadow-yellow-500/20">
              Access Pro Models
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
          {chatMessages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 opacity-30">
              <i className="fa-solid fa-rocket text-4xl"></i>
              <p className="text-sm">Initiate a generation pass to populate the chamber.</p>
            </div>
          )}
          {chatMessages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] p-4 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-indigo-600/20 border border-indigo-500/30 text-slate-100 rounded-tr-none shadow-lg' : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700'}`}>
                {m.text}
                
                {/* Image Render */}
                {m.image && (
                  <div className="mt-4 flex flex-col gap-2">
                      <div className="rounded-lg overflow-hidden border border-slate-700 shadow-2xl bg-slate-950 group relative">
                        <img src={m.image} alt="Pro Visualization" className="w-full h-auto" />
                        <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                          <button onClick={() => { const link = document.createElement('a'); link.href = m.image!; link.download = 'forge-render.png'; link.click(); }} className="bg-yellow-500 text-slate-950 p-3 rounded-full hover:scale-110 transition-transform">
                            <i className="fa-solid fa-download"></i>
                          </button>
                        </div>
                      </div>
                      
                      {/* Save to Registry Button */}
                      {mode !== AppMode.STORY && !m.isStoryboard && (
                           <button 
                             onClick={() => {
                                 const currentName = mode === AppMode.CHARACTER ? charData.name : mode === AppMode.ENVIRONMENT ? envData.name : propData.name;
                                 handleSaveElement(mode, currentName || 'Untitled', m.text.substring(0, 100), m.image!);
                             }}
                             className="w-full py-2 bg-slate-700 hover:bg-green-600 text-white text-xs font-bold rounded flex items-center justify-center gap-2 transition-colors"
                           >
                               <i className="fa-solid fa-floppy-disk"></i>
                               Save {mode} to Registry
                           </button>
                      )}

                      {/* Storyboard Upscale Controls */}
                      {m.isStoryboard && (
                          <div className="grid grid-cols-2 gap-2 mt-1">
                              {[1, 2, 3, 4].map(panel => (
                                  <button
                                    key={panel}
                                    onClick={() => generateImage(`Upscale Panel ${panel}: ${m.text.substring(0, 30)}... Full resolution, high detail.`, false)}
                                    className="bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white text-[10px] py-1.5 rounded border border-slate-700 transition-colors"
                                  >
                                      Upscale P{panel}
                                  </button>
                              ))}
                          </div>
                      )}
                  </div>
                )}

                {/* Audio Render */}
                {m.audioData && (
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 flex items-center gap-3">
                      <button 
                        onClick={() => playAudio(m.audioData!)}
                        className="w-10 h-10 rounded-full bg-pink-500 hover:bg-pink-400 text-slate-950 flex items-center justify-center transition-transform hover:scale-105"
                      >
                        <i className="fa-solid fa-play"></i>
                      </button>
                      <div className="flex-1">
                        <div className="h-1 bg-slate-700 rounded-full w-full overflow-hidden">
                          <div className="h-full bg-pink-500 w-1/2 opacity-50"></div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">{charData.voiceProfile} Voice</p>
                      </div>
                      <div className="flex gap-2">
                         <button 
                            onClick={() => generateVoice(m.text.replace(/"/g, ''))} 
                            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
                            title="Regenerate Voice"
                         >
                           <i className="fa-solid fa-arrows-rotate"></i>
                         </button>
                         <button 
                            onClick={() => downloadAudio(m.audioData!, charData.name, m.text)} 
                            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
                            title="Download WAV"
                         >
                           <i className="fa-solid fa-download"></i>
                         </button>
                      </div>
                    </div>
                  </div>
                )}

                {idx === chatMessages.length - 1 && isTyping && (
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce delay-75"></span>
                      <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-bounce delay-150"></span>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeRefImage && <div className="w-6 h-6 rounded border border-yellow-500/50 overflow-hidden shrink-0"><img src={activeRefImage} className="w-full h-full object-cover" alt="ref" /></div>}
                      {genStatus && <p className="text-[10px] text-yellow-500/60 uppercase tracking-widest font-black animate-pulse">{genStatus}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form onSubmit={handleChatSubmit} className="p-4 bg-slate-950 border-t border-slate-800">
          <div className="relative">
            <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Refine with Pro Engine..." className="w-full bg-slate-900 border border-slate-700 rounded-xl py-4 pl-5 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50 transition-all text-slate-200" />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {/* Add direct voice generation button to chat input */}
              {mode === AppMode.CHARACTER && chatInput.trim().length > 0 && (
                <button 
                  type="button"
                  onClick={() => { generateVoice(chatInput); setChatInput(''); }}
                  className="p-2 text-pink-500 hover:text-pink-400 transition-colors"
                  title="Speak this text"
                >
                  <i className="fa-solid fa-microphone-lines"></i>
                </button>
              )}
              <button type="submit" disabled={isTyping || !chatInput.trim()} className="p-2 text-yellow-500 hover:text-yellow-400 disabled:opacity-20 transition-all">
                <i className="fa-solid fa-paper-plane text-lg"></i>
              </button>
            </div>
          </div>
          <div className="mt-3 flex justify-between items-center text-[9px] text-slate-600 uppercase font-black tracking-widest">
            <span className="flex items-center gap-1">
              <i className={`fa-solid ${activeRefImage ? 'fa-link text-yellow-500' : 'fa-microchip'}`}></i> 
              {activeRefImage ? 'Character Lock Active' : 'Gemini 3 Pro Image'}
            </span>
            <button type="button" onClick={() => setActiveRefImage(null)} className={`hover:text-yellow-500 transition-colors ${activeRefImage ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>Reset Consistency</button>
          </div>
        </form>
      </div>
    </div>
  );
}
