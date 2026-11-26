export const COLORS = {
  // Node type colors
  PROJECT: '#007AFF',
  MILESTONE: '#FF9500', 
  TASK: '#34C759',
  PORTFOLIO: '#5856D6',

  // Status colors
  NOT_STARTED: '#8E8E93',
  IN_PROGRESS: '#FF9500',
  COMPLETED: '#34C759',
  BLOCKED: '#FF3B30',

  // UI colors
  PRIMARY: '#007AFF',
  SECONDARY: '#5856D6',
  SUCCESS: '#34C759',
  WARNING: '#FF9500',
  ERROR: '#FF3B30',
  INFO: '#5AC8FA',

  // Neutral colors
  BACKGROUND: '#F8F9FA',
  SURFACE: '#FFFFFF',
  BORDER: '#E5E5EA',
  TEXT_PRIMARY: '#1C1C1E',
  TEXT_SECONDARY: '#8E8E93',
  TEXT_DISABLED: '#C7C7CC'
} as const

export const GRADIENTS = {
  PROJECT: 'linear-gradient(135deg, #007AFF, #5856D6)',
  MILESTONE: 'linear-gradient(135deg, #FF9500, #FF6B35)',
  TASK: 'linear-gradient(135deg, #34C759, #30D158)',
  CANVAS: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)'
} as const

export const SIZES = {
  // Node sizes
  NODE_WIDTH: {
    PROJECT: 250,
    MILESTONE: 200,
    TASK: 180
  },
  NODE_HEIGHT: {
    PROJECT: 120,
    MILESTONE: 100,
    TASK: 80
  },

  // Spacing
  SPACING: {
    XS: 4,
    SM: 8,
    MD: 16,
    LG: 24,
    XL: 32,
    XXL: 48
  },

  // Touch targets
  TOUCH_TARGET: {
    MIN: 44,
    PREFERRED: 48
  },

  // Canvas bounds
  CANVAS_BOUNDS: {
    MIN_ZOOM: 0.5,
    MAX_ZOOM: 3,
    PAN_BOUNDS: 2000
  }
} as const

export const ANIMATIONS = {
  // Durations (ms)
  FAST: 150,
  NORMAL: 300,
  SLOW: 500,

  // Easing
  EASE_OUT: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  EASE_IN_OUT: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  
  // Spring configs
  SPRING: {
    tension: 300,
    friction: 30
  }
} as const