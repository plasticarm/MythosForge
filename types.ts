
export enum DetailLevel {
  SIMPLE = 'Simple',
  INTERMEDIATE = 'Intermediate',
  COMPLEX = 'Complex'
}

export enum AppMode {
  GLOBALS = 'Globals',
  CHARACTER = 'Character',
  ENVIRONMENT = 'Environment',
  PROP = 'Prop',
  STORY = 'Story',
  CHRONICLE = 'Chronicle'
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  apiKeys: {
    gemini?: string;
    elevenLabs?: string;
  };
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  image?: string;
  audioData?: string; // base64 encoded audio
  status?: string;
  isReference?: boolean;
  isStoryboard?: boolean; 
  isMultiView?: boolean; 
}

export interface GlobalData {
  style: string;
  timePeriod: string;
  genre: string;
  lightingTheme: string;
  colorPalette: string;
  customApiKey?: string;
  elevenLabsApiKey?: string; 
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  imageQuality: "1K" | "2K";
  styleReferenceImages: string[];
  googleSheetUrl?: string;
  googleClientId?: string;
}

export interface SavedElement {
  id: string;
  type: AppMode;
  name: string;
  description: string;
  imageUrl: string;
}

export interface StoryData {
  synopsis: string;
  fullStory: string;
  storyScenes: string[]; 
}

export interface Session {
  id: string;
  userId: string; // Owner of the session
  name: string;
  lastModified: number;
  data: {
    mode: AppMode;
    globalData: GlobalData;
    charData: CharacterData;
    characterLibrary: CharacterData[];
    envData: EnvironmentData;
    environmentLibrary: EnvironmentData[];
    propData: PropData;
    propLibrary: PropData[];
    storyData: StoryData;
    savedElements: SavedElement[];
    chatMessages: Message[];
  };
}

export interface CharacterData {
  id?: string;
  name: string;
  species: string;
  age: string;
  role: string;
  archetype: string;
  physicalDescription: string;
  personality: string;
  motivation: string;
  flaws: string;
  backstory: string;
  speechPatterns: string;
  secrets: string;
  visualStyle: string;
  keyActions: string;
  hairColor: string;
  eyeColor: string;
  height: string;
  build: string;
  distinguishingFeatures: string;
  skinTone: string;
  tattoosMarkings: string;
  clothingStyle: string;
  postureGait: string;
  scent: string;
  alignment: string;
  phobias: string;
  hobbies: string;
  intelligence: string;
  placeOfBirth: string;
  socialClass: string;
  beliefs: string;
  languages: string;
  signatureWeapon: string;
  specialAbilities: string;
  combatStyle: string;
  reputation: string;
  allies: string;
  enemies: string;
  petCompanion: string;
  voiceProvider: 'Gemini' | 'ElevenLabs'; 
  voiceProfile: string; 
  elevenLabsVoiceId?: string; 
  voiceDescription: string;
  customImage?: string;
  additionalDetails?: string;
}

export interface EnvironmentData {
  id?: string;
  name: string;
  biome: string;
  timeOfDay: string;
  weather: string;
  atmosphere: string;
  architecture: string;
  landmarks: string;
  history: string;
  lighting: string;
  visualStyle: string;
  scale: string;
  colors: string;
  customImage?: string;
  additionalDetails?: string;
}

export interface PropData {
  id?: string;
  name: string;
  category: string;
  material: string;
  size: string;
  weight: string;
  condition: string;
  origin: string;
  properties: string;
  visualDetails: string;
  history: string;
  visualStyle: string;
  customImage?: string;
  additionalDetails?: string;
}

export interface RandomPool {
  names: string[];
  species: string[];
  roles: string[];
  archetypes: string[];
  personalityTraits: string[];
  motivations: string[];
  flaws: string[];
  visualStyles: string[];
  hairColors: string[];
  eyeColors: string[];
  heights: string[];
  builds: string[];
  features: string[];
  biomes: string[];
  times: string[];
  weathers: string[];
  atmospheres: string[];
  architectures: string[];
  landmarks: string[];
  propCategories: string[];
  materials: string[];
  conditions: string[];
  properties: string[];
  genres: string[];
  timePeriods: string[];
  lightingThemes: string[];
  skinTones: string[];
  alignments: string[];
  intelligences: string[];
  socialClasses: string[];
  weapons: string[];
  combatStyles: string[];
  voices: string[];
  scents: string[];
  tattoos: string[];
  gaits: string[];
  clothing: string[];
  phobias: string[];
  hobbies: string[];
  places: string[];
  beliefs: string[];
  languages: string[];
  reputations: string[];
  allies: string[];
  enemies: string[];
  backstories: string[];
  secrets: string[];
  abilities: string[];
  pets: string[];
  voiceDescriptions: string[];
  storySynopses: string[];
}

declare global {
  interface Window {
    google?: any;
  }
}
