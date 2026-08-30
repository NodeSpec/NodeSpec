import type { ProjectSpecification } from './specification.js';

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }>;
  suggestions: string[];
}

const KNOWN_LANGUAGES = [
  'typescript', 'javascript', 'python', 'java', 'go', 'rust', 'ruby', 'php', 'c#', 'swift', 'kotlin'
];

const KNOWN_FRAMEWORKS = {
  typescript: ['react', 'vue', 'angular', 'svelte', 'next.js', 'express', 'nest.js', 'fastify'],
  javascript: ['react', 'vue', 'angular', 'svelte', 'next.js', 'express', 'koa', 'hapi'],
  python: ['django', 'flask', 'fastapi', 'tornado', 'pyramid'],
  java: ['spring', 'spring boot', 'quarkus', 'micronaut'],
  go: ['gin', 'echo', 'fiber', 'chi'],
  rust: ['actix', 'rocket', 'warp', 'axum'],
  ruby: ['rails', 'sinatra', 'hanami'],
  php: ['laravel', 'symfony', 'slim'],
};

const KNOWN_DATABASES = [
  'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'cassandra', 'sqlite'
];

const DEPLOYMENT_TARGETS = [
  'vercel', 'netlify', 'aws', 'gcp', 'azure', 'heroku', 'docker', 'kubernetes', 'serverless'
];

const FRONTEND_KEYWORDS = ['web', 'ui', 'frontend', 'dashboard', 'app', 'interface', 'client', 'browser'];
const BACKEND_KEYWORDS = ['api', 'backend', 'server', 'service', 'microservice', 'rest', 'graphql'];
const DATABASE_KEYWORDS = ['database', 'storage', 'data', 'persistence', 'sql', 'nosql'];
const REALTIME_KEYWORDS = ['realtime', 'real-time', 'websocket', 'live', 'streaming', 'push'];
const MOBILE_KEYWORDS = ['mobile', 'ios', 'android', 'app', 'responsive'];

export function validateSpecification(spec: Partial<ProjectSpecification>): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const suggestions: string[] = [];

  if (!spec.vision || spec.vision.trim().length === 0) {
    errors.push({
      field: 'vision',
      message: 'Project vision is required',
      severity: 'error',
    });
  } else if (spec.vision.trim().length < 10) {
    errors.push({
      field: 'vision',
      message: 'Project vision is too short. Please provide more details about what you want to build.',
      severity: 'error',
    });
  } else if (spec.vision.trim().length > 2000) {
    errors.push({
      field: 'vision',
      message: 'Project vision is too long. Please keep it under 2000 characters.',
      severity: 'error',
    });
  }

  const visionLower = spec.vision?.toLowerCase() || '';

  if (spec.preferences?.languages && spec.preferences.languages.length > 0) {
    const unknownLanguages = spec.preferences.languages.filter(
      lang => !KNOWN_LANGUAGES.includes(lang.toLowerCase())
    );
    if (unknownLanguages.length > 0) {
      errors.push({
        field: 'preferences.languages',
        message: `Unknown languages: ${unknownLanguages.join(', ')}. Known languages: ${KNOWN_LANGUAGES.join(', ')}`,
        severity: 'warning',
      });
    }
  }

  if (spec.preferences?.frameworks && spec.preferences.frameworks.length > 0) {
    for (const framework of spec.preferences.frameworks) {
      const frameworkLower = framework.toLowerCase();
      const isKnown = Object.values(KNOWN_FRAMEWORKS)
        .flat()
        .some(f => f.toLowerCase() === frameworkLower);

      if (!isKnown) {
        errors.push({
          field: 'preferences.frameworks',
          message: `Unknown framework: ${framework}. This may work, but AI might not have specific guidance for it.`,
          severity: 'warning',
        });
      }
    }
  }

  if (spec.preferences?.databases && spec.preferences.databases.length > 0) {
    const unknownDatabases = spec.preferences.databases.filter(
      db => !KNOWN_DATABASES.includes(db.toLowerCase())
    );
    if (unknownDatabases.length > 0) {
      errors.push({
        field: 'preferences.databases',
        message: `Unknown databases: ${unknownDatabases.join(', ')}. Known databases: ${KNOWN_DATABASES.join(', ')}`,
        severity: 'warning',
      });
    }
  }

  if (spec.preferences?.deploymentTarget) {
    const deploymentLower = spec.preferences.deploymentTarget.toLowerCase();
    if (!DEPLOYMENT_TARGETS.some(t => deploymentLower.includes(t))) {
      errors.push({
        field: 'preferences.deploymentTarget',
        message: `Unknown deployment target: ${spec.preferences.deploymentTarget}. Known targets: ${DEPLOYMENT_TARGETS.join(', ')}`,
        severity: 'warning',
      });
    }
  }

  const hasFrontendKeyword = FRONTEND_KEYWORDS.some(kw => visionLower.includes(kw));
  const hasBackendKeyword = BACKEND_KEYWORDS.some(kw => visionLower.includes(kw));
  const hasDatabaseKeyword = DATABASE_KEYWORDS.some(kw => visionLower.includes(kw));
  const hasRealtimeKeyword = REALTIME_KEYWORDS.some(kw => visionLower.includes(kw));
  const hasMobileKeyword = MOBILE_KEYWORDS.some(kw => visionLower.includes(kw));

  if (hasFrontendKeyword && !spec.preferences?.languages?.some(l =>
    ['typescript', 'javascript'].includes(l.toLowerCase())
  ) && !spec.preferences?.frameworks?.some(f =>
    ['react', 'vue', 'angular', 'svelte'].includes(f.toLowerCase())
  )) {
    suggestions.push(
      'Your project mentions UI/frontend. Consider specifying a frontend framework like React, Vue, or Angular.'
    );
  }

  if (hasBackendKeyword && !spec.preferences?.languages?.length) {
    suggestions.push(
      'Your project mentions backend/API. Consider specifying a backend language like TypeScript, Python, or Go.'
    );
  }

  if (hasDatabaseKeyword && !spec.preferences?.databases?.length) {
    suggestions.push(
      'Your project mentions data storage. Consider specifying a database like PostgreSQL, MongoDB, or Redis.'
    );
  }

  if (hasRealtimeKeyword) {
    suggestions.push(
      'Your project mentions real-time features. The AI will likely include WebSocket servers or streaming infrastructure.'
    );
  }

  if (hasMobileKeyword && !hasFrontendKeyword) {
    suggestions.push(
      'Your project mentions mobile. Consider clarifying if you want a native mobile app (React Native, Flutter) or a responsive web app.'
    );
  }

  if (spec.preferences?.languages && spec.preferences.languages.length > 3) {
    errors.push({
      field: 'preferences.languages',
      message: 'Too many languages specified. Consider limiting to 2-3 primary languages for better architecture focus.',
      severity: 'warning',
    });
  }

  if (spec.preferences?.frameworks && spec.preferences.languages) {
    for (const framework of spec.preferences.frameworks) {
      const frameworkLower = framework.toLowerCase();
      let compatibleLanguage = false;

      for (const lang of spec.preferences.languages) {
        const langLower = lang.toLowerCase();
        const langFrameworks = KNOWN_FRAMEWORKS[langLower as keyof typeof KNOWN_FRAMEWORKS] || [];
        if (langFrameworks.some(f => f.toLowerCase() === frameworkLower)) {
          compatibleLanguage = true;
          break;
        }
      }

      if (!compatibleLanguage && Object.values(KNOWN_FRAMEWORKS).flat().includes(frameworkLower)) {
        errors.push({
          field: 'preferences.frameworks',
          message: `Framework "${framework}" may not be compatible with specified languages: ${spec.preferences.languages.join(', ')}`,
          severity: 'warning',
        });
      }
    }
  }

  if (!hasFrontendKeyword && !hasBackendKeyword && !hasDatabaseKeyword) {
    suggestions.push(
      'Your vision is quite general. Consider mentioning specific components like "web interface", "REST API", or "database" to get better architecture suggestions.'
    );
  }

  return {
    valid: errors.filter(e => e.severity === 'error').length === 0,
    errors,
    suggestions,
  };
}

export function inferMissingPreferences(vision: string): Partial<ProjectSpecification['preferences']> {
  const visionLower = vision.toLowerCase();
  const preferences: Partial<ProjectSpecification['preferences']> = {};

  const hasFrontend = FRONTEND_KEYWORDS.some(kw => visionLower.includes(kw));
  const hasBackend = BACKEND_KEYWORDS.some(kw => visionLower.includes(kw));
  const hasDatabase = DATABASE_KEYWORDS.some(kw => visionLower.includes(kw));

  if (hasFrontend && hasBackend) {
    if (visionLower.includes('microservice')) {
      preferences.architecturePattern = 'microservices';
    } else if (visionLower.includes('serverless') || visionLower.includes('lambda')) {
      preferences.architecturePattern = 'serverless';
    } else {
      preferences.architecturePattern = 'monolith';
    }
  }

  if (hasFrontend && !preferences.languages?.includes('typescript')) {
    suggestions.push('TypeScript');
    suggestions.push('React');
  }

  if (hasBackend && !preferences.languages?.length) {
    if (visionLower.includes('fast') || visionLower.includes('high performance')) {
      suggestions.push('Go or Rust for high performance');
    } else {
      suggestions.push('TypeScript/Node.js for rapid development');
    }
  }

  if (hasDatabase && !preferences.databases?.length) {
    if (visionLower.includes('relational') || visionLower.includes('sql')) {
      suggestions.push('PostgreSQL');
    } else if (visionLower.includes('nosql') || visionLower.includes('document')) {
      suggestions.push('MongoDB');
    } else {
      suggestions.push('PostgreSQL (versatile choice)');
    }
  }

  return preferences;
}

const suggestions: string[] = [];

export function sanitizeSpecification(spec: Partial<ProjectSpecification>): Partial<ProjectSpecification> {
  const sanitized = { ...spec };

  if (sanitized.vision) {
    sanitized.vision = sanitized.vision.trim();
  }

  if (sanitized.preferences?.languages) {
    sanitized.preferences.languages = sanitized.preferences.languages
      .map(l => l.toLowerCase().trim())
      .filter(Boolean);
  }

  if (sanitized.preferences?.frameworks) {
    sanitized.preferences.frameworks = sanitized.preferences.frameworks
      .map(f => f.toLowerCase().trim())
      .filter(Boolean);
  }

  if (sanitized.preferences?.databases) {
    sanitized.preferences.databases = sanitized.preferences.databases
      .map(d => d.toLowerCase().trim())
      .filter(Boolean);
  }

  if (sanitized.constraints) {
    sanitized.constraints = sanitized.constraints.filter(c => c.description && c.description.trim().length > 0);
  }

  return sanitized;
}
