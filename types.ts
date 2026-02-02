

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
  STORY = 'Story'
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  image?: string;
  audioData?: string; // base64 encoded audio
  status?: string;
  isReference?: boolean;
  isStoryboard?: boolean; // Flag for storyboard grids
}

export interface GlobalData {
  style: string;
  timePeriod: string;
  genre: string;
  lightingTheme: string;
  colorPalette: string;
  customApiKey?: string;
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
  storyScenes: string[]; // Breakdown of story into segments
}

export interface Session {
  id: string;
  name: string;
  lastModified: number;
  data: {
    mode: AppMode;
    globalData: GlobalData;
    charData: CharacterData;
    envData: EnvironmentData;
    propData: PropData;
    storyData: StoryData;
    savedElements: SavedElement[];
    chatMessages: Message[];
  };
}

export interface CharacterData {
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
  // New Attributes
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
  // Voice
  voiceProfile: string;
  voiceDescription: string;
}

export interface EnvironmentData {
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
}

export interface PropData {
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
  propCategories: string[];
  materials: string[];
  conditions: string[];
  properties: string[];
  genres: string[];
  timePeriods: string[];
  lightingThemes: string[];
  // New Pools
  skinTones: string[];
  alignments: string[];
  intelligences: string[];
  socialClasses: string[];
  weapons: string[];
  combatStyles: string[];
  voices: string[];
  // Comprehensive Coverage Pools
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
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: any) => void;
          }) => { requestAccessToken: () => void };
        }
      }
    };
  }
}