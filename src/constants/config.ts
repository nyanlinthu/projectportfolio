export const APP_CONFIG = {
  NAME: 'ProjectPortfolio',
  DESCRIPTION: 'Mobile-first Work Breakdown Structure PWA',
  VERSION: '1.0.0',
  
  // Development
  DEV_SERVER_PORT: 3000,
  
  // Performance
  VIRTUAL_CANVAS_BUFFER: 200,
  FIREBASE_SYNC_DEBOUNCE: 2000,
  
  // Gesture thresholds
  CANVAS_DRAG_THRESHOLD: 10,
  NODE_DRAG_THRESHOLD: 3,
  
  // Default project settings
  DEFAULT_MILESTONE_COUNT: 3,
  DEFAULT_PROJECT_TIMELINE_DAYS: 90
} as const

export const FIREBASE_CONFIG = {
  COLLECTIONS: {
    USERS: 'users',
    PROJECTS: 'projects', 
    NODES: 'nodes'
  },
  
  // Batch limits
  BATCH_SIZE: 50,
  
  // Query limits
  MAX_NODES_PER_QUERY: 1000
} as const

export const ROUTES = {
  HOME: '/',
  PROJECT: '/project/:projectId',
  CHARTER: '/charter'
} as const

export const STORAGE_KEYS = {
  USER_PREFERENCES: 'projectportfolio_user_preferences',
  CANVAS_STATE: 'projectportfolio_canvas_state',
  RECENT_PROJECTS: 'projectportfolio_recent_projects'
} as const

export const NODE_TYPES = {
  PORTFOLIO: 'portfolio',
  PROJECT: 'project', 
  MILESTONE: 'milestone',
  TASK: 'task'
} as const

export const NODE_STATUS = {
  NOT_STARTED: 'not-started',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  BLOCKED: 'blocked'
} as const