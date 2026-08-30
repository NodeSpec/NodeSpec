import type { ArtifactPlaceholder } from './templates.js';
import type { ProgrammingLanguage } from './node-metadata.js';
import { getFileExtensionForLanguage } from './language-support.js';

export interface LanguageTemplateContext {
  nodeTypeId: string;
  language: ProgrammingLanguage;
  framework?: string;
  runtime?: string;
}

export function generateLanguageSpecificArtifacts(
  context: LanguageTemplateContext
): ArtifactPlaceholder[] {
  switch (context.nodeTypeId) {
    case 'frontend.html-css':
      return generateHTMLCSSArtifacts(context);
    case 'frontend.app':
    case 'frontend.react':
    case 'frontend.vue':
    case 'frontend.angular':
    case 'frontend.svelte':
    case 'frontend.solid':
    case 'frontend.next':
    case 'frontend.nuxt':
    case 'frontend.astro':
    case 'frontend.blazor':
    case 'frontend.yew':
    case 'frontend.dioxus':
      return generateFrontendArtifacts(context);
    case 'backend.nodejs':
    case 'backend.rust':
    case 'backend.python':
    case 'backend.go':
    case 'backend.ruby':
      return generateBackendRuntimeArtifacts(context);
    case 'desktop.electron':
    case 'desktop.tauri':
      return generateDesktopArtifacts(context);
    case 'web.rest-api':
      return generateRESTAPIArtifacts(context);
    case 'web.graphql-api':
      return generateGraphQLAPIArtifacts(context);
    case 'web.grpc-service':
      return generateGRPCServiceArtifacts(context);
    case 'gateway.aws-api-gateway':
      return generateAWSAPIGatewayArtifacts(context);
    case 'gateway.azure-api-management':
      return generateAzureAPIMgmtArtifacts(context);
    case 'gateway.gcp-api-gateway':
      return generateGCPAPIGatewayArtifacts(context);
    case 'gateway.kong':
      return generateKongGatewayArtifacts(context);
    case 'lb.aws-alb':
    case 'lb.aws-nlb':
      return generateAWSLoadBalancerArtifacts(context);
    case 'lb.azure-load-balancer':
    case 'lb.azure-app-gateway':
      return generateAzureLoadBalancerArtifacts(context);
    case 'lb.gcp-load-balancer':
      return generateGCPLoadBalancerArtifacts(context);
    case 'lb.nginx':
      return generateNginxLoadBalancerArtifacts(context);
    case 'lb.haproxy':
      return generateHAProxyLoadBalancerArtifacts(context);
    case 'auth.supabase-auth':
    case 'auth.auth0':
    case 'auth.aws-cognito':
    case 'auth.keycloak':
    case 'auth.firebase-auth':
    case 'auth.azure-ad-b2c':
      return generateAuthServiceArtifacts(context);
    case 'cache.redis':
    case 'cache.memcached':
    case 'cache.valkey':
    case 'cache.elasticache':
    case 'cache.cloudflare-kv':
      return generateCacheServiceArtifacts(context);
    default:
      return [];
  }
}

function generateHTMLCSSArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'source',
      suggestedPath: 'index.html',
      description: 'Main HTML file with semantic structure',
      language: 'html',
    },
    {
      kind: 'source',
      suggestedPath: 'css/styles.css',
      description: 'Main CSS stylesheet with responsive design',
      language: 'css',
    },
    {
      kind: 'source',
      suggestedPath: 'js/app.js',
      description: 'Main JavaScript file with ES6+ features',
      language: 'javascript',
    },
    {
      kind: 'doc',
      suggestedPath: 'README.md',
      description: 'Project documentation and setup instructions',
    },
  ];
}

function generateBackendRuntimeArtifacts(context: LanguageTemplateContext): ArtifactPlaceholder[] {
  const { nodeTypeId } = context;

  if (nodeTypeId === 'backend.nodejs') {
    return [
      {
        kind: 'config',
        suggestedPath: 'package.json',
        description: 'NPM dependencies including Express and TypeScript',
        language: 'json',
      },
      {
        kind: 'config',
        suggestedPath: 'tsconfig.json',
        description: 'TypeScript compiler configuration',
        language: 'json',
      },
      {
        kind: 'source',
        suggestedPath: 'src/server.ts',
        description: 'Express server entry point with middleware setup',
        language: 'typescript',
      },
      {
        kind: 'source',
        suggestedPath: 'src/routes/index.ts',
        description: 'API routes configuration',
        language: 'typescript',
      },
      {
        kind: 'source',
        suggestedPath: 'src/middleware/error-handler.ts',
        description: 'Centralized error handling middleware',
        language: 'typescript',
      },
      {
        kind: 'config',
        suggestedPath: '.env.example',
        description: 'Environment variables template',
      },
    ];
  }

  if (nodeTypeId === 'backend.rust') {
    return [
      {
        kind: 'config',
        suggestedPath: 'Cargo.toml',
        description: 'Rust dependencies including Actix/Axum and Tokio',
        language: 'toml',
      },
      {
        kind: 'source',
        suggestedPath: 'src/main.rs',
        description: 'Main server entry point with async runtime',
        language: 'rust',
      },
      {
        kind: 'source',
        suggestedPath: 'src/routes/mod.rs',
        description: 'API routes module',
        language: 'rust',
      },
      {
        kind: 'source',
        suggestedPath: 'src/handlers/mod.rs',
        description: 'Request handlers',
        language: 'rust',
      },
      {
        kind: 'source',
        suggestedPath: 'src/error.rs',
        description: 'Custom error types and handlers',
        language: 'rust',
      },
      {
        kind: 'config',
        suggestedPath: '.env.example',
        description: 'Environment variables template',
      },
    ];
  }

  if (nodeTypeId === 'backend.python') {
    return [
      {
        kind: 'config',
        suggestedPath: 'requirements.txt',
        description: 'Python dependencies including FastAPI',
        language: 'text',
      },
      {
        kind: 'config',
        suggestedPath: 'pyproject.toml',
        description: 'Python project configuration',
        language: 'toml',
      },
      {
        kind: 'source',
        suggestedPath: 'main.py',
        description: 'FastAPI application entry point',
        language: 'python',
      },
      {
        kind: 'source',
        suggestedPath: 'routers/__init__.py',
        description: 'API routers module',
        language: 'python',
      },
      {
        kind: 'source',
        suggestedPath: 'models.py',
        description: 'Pydantic models and schemas',
        language: 'python',
      },
      {
        kind: 'config',
        suggestedPath: '.env.example',
        description: 'Environment variables template',
      },
    ];
  }

  if (nodeTypeId === 'backend.go') {
    return [
      {
        kind: 'config',
        suggestedPath: 'go.mod',
        description: 'Go module dependencies',
        language: 'go',
      },
      {
        kind: 'source',
        suggestedPath: 'main.go',
        description: 'Main server entry point',
        language: 'go',
      },
      {
        kind: 'source',
        suggestedPath: 'handlers/handlers.go',
        description: 'HTTP request handlers',
        language: 'go',
      },
      {
        kind: 'source',
        suggestedPath: 'routes/routes.go',
        description: 'API route definitions',
        language: 'go',
      },
      {
        kind: 'source',
        suggestedPath: 'middleware/middleware.go',
        description: 'HTTP middleware functions',
        language: 'go',
      },
      {
        kind: 'config',
        suggestedPath: '.env.example',
        description: 'Environment variables template',
      },
    ];
  }

  if (nodeTypeId === 'backend.ruby') {
    return [
      {
        kind: 'config',
        suggestedPath: 'Gemfile',
        description: 'Ruby dependencies including Rails or Sinatra',
        language: 'ruby',
      },
      {
        kind: 'config',
        suggestedPath: 'config.ru',
        description: 'Rack configuration file',
        language: 'ruby',
      },
      {
        kind: 'source',
        suggestedPath: 'app/controllers/application_controller.rb',
        description: 'Base controller with common functionality',
        language: 'ruby',
      },
      {
        kind: 'source',
        suggestedPath: 'app/models/application_record.rb',
        description: 'Base model class',
        language: 'ruby',
      },
      {
        kind: 'source',
        suggestedPath: 'config/routes.rb',
        description: 'Application routes definition',
        language: 'ruby',
      },
      {
        kind: 'config',
        suggestedPath: 'config/database.yml',
        description: 'Database configuration',
        language: 'yaml',
      },
      {
        kind: 'config',
        suggestedPath: '.env.example',
        description: 'Environment variables template',
      },
    ];
  }

  return [];
}

function generateDesktopArtifacts(context: LanguageTemplateContext): ArtifactPlaceholder[] {
  const { nodeTypeId } = context;

  if (nodeTypeId === 'desktop.electron') {
    return [
      {
        kind: 'config',
        suggestedPath: 'package.json',
        description: 'NPM dependencies including Electron',
        language: 'json',
      },
      {
        kind: 'source',
        suggestedPath: 'main.js',
        description: 'Electron main process entry point',
        language: 'javascript',
      },
      {
        kind: 'source',
        suggestedPath: 'preload.js',
        description: 'Preload script for secure IPC',
        language: 'javascript',
      },
      {
        kind: 'source',
        suggestedPath: 'src/index.html',
        description: 'Main renderer process HTML',
        language: 'html',
      },
      {
        kind: 'source',
        suggestedPath: 'src/renderer.js',
        description: 'Renderer process JavaScript',
        language: 'javascript',
      },
      {
        kind: 'config',
        suggestedPath: 'electron-builder.json',
        description: 'Build configuration for packaging',
        language: 'json',
      },
    ];
  }

  if (nodeTypeId === 'desktop.tauri') {
    return [
      {
        kind: 'config',
        suggestedPath: 'package.json',
        description: 'Frontend dependencies',
        language: 'json',
      },
      {
        kind: 'config',
        suggestedPath: 'src-tauri/Cargo.toml',
        description: 'Rust dependencies including Tauri',
        language: 'toml',
      },
      {
        kind: 'config',
        suggestedPath: 'src-tauri/tauri.conf.json',
        description: 'Tauri application configuration',
        language: 'json',
      },
      {
        kind: 'source',
        suggestedPath: 'src-tauri/src/main.rs',
        description: 'Tauri backend entry point',
        language: 'rust',
      },
      {
        kind: 'source',
        suggestedPath: 'src-tauri/src/commands.rs',
        description: 'Tauri command handlers',
        language: 'rust',
      },
      {
        kind: 'source',
        suggestedPath: 'src/main.ts',
        description: 'Frontend entry point',
        language: 'typescript',
      },
    ];
  }

  return [];
}

function generateFrontendArtifacts(context: LanguageTemplateContext): ArtifactPlaceholder[] {
  const { language, framework } = context;
  const ext = getFileExtensionForLanguage(language);

  switch (language) {
    case 'typescript':
    case 'javascript':
      return [
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'NPM dependencies and build scripts',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: `src/App${ext}x`,
          description: `Main ${framework || 'React'} application component`,
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `src/main${ext}`,
          description: 'Application entry point',
          language: language,
        },
        {
          kind: 'config',
          suggestedPath: language === 'typescript' ? 'vite.config.ts' : 'vite.config.js',
          description: 'Vite build configuration',
          language: language,
        },
        {
          kind: 'config',
          suggestedPath: 'tsconfig.json',
          description: 'TypeScript configuration',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/index.css',
          description: 'Global styles',
          language: 'css',
        },
        {
          kind: 'source',
          suggestedPath: `src/components/Layout${ext}x`,
          description: 'Layout component',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `src/pages/Home${ext}x`,
          description: 'Home page component',
          language: language,
        },
      ];

    case 'csharp':
      return [
        {
          kind: 'source',
          suggestedPath: 'Program.cs',
          description: 'Blazor application entry point',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'App.razor',
          description: 'Root application component',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Pages/Index.razor',
          description: 'Home page component',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Shared/MainLayout.razor',
          description: 'Main layout component',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Shared/NavMenu.razor',
          description: 'Navigation menu component',
          language: 'csharp',
        },
        {
          kind: 'config',
          suggestedPath: 'wwwroot/css/app.css',
          description: 'Application styles',
          language: 'css',
        },
        {
          kind: 'config',
          suggestedPath: 'wwwroot/index.html',
          description: 'Static HTML host page',
          language: 'html',
        },
        {
          kind: 'config',
          suggestedPath: 'BlazorApp.csproj',
          description: 'Project file with Blazor dependencies',
          language: 'xml',
        },
      ];

    case 'rust':
      return [
        {
          kind: 'source',
          suggestedPath: 'src/main.rs',
          description: `${framework === 'yew' ? 'Yew' : 'Web'} application entry point`,
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/app.rs',
          description: 'Root application component',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/components/mod.rs',
          description: 'Component module exports',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/components/layout.rs',
          description: 'Layout component',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/pages/mod.rs',
          description: 'Page module exports',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/pages/home.rs',
          description: 'Home page component',
          language: 'rust',
        },
        {
          kind: 'config',
          suggestedPath: 'Cargo.toml',
          description: `Rust dependencies with ${framework || 'web framework'}`,
          language: 'toml',
        },
        {
          kind: 'config',
          suggestedPath: 'index.html',
          description: 'HTML entry point',
          language: 'html',
        },
        {
          kind: 'config',
          suggestedPath: 'styles/app.css',
          description: 'Application styles',
          language: 'css',
        },
      ];

    default:
      return [
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'NPM dependencies and build scripts',
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'src/App.tsx',
          description: 'Main application component',
          language: 'typescript',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main.tsx',
          description: 'Application entry point',
          language: 'typescript',
        },
      ];
  }
}

function generateRESTAPIArtifacts(context: LanguageTemplateContext): ArtifactPlaceholder[] {
  const { language, framework } = context;
  const ext = getFileExtensionForLanguage(language);

  const common: ArtifactPlaceholder[] = [
    {
      kind: 'schema',
      suggestedPath: 'api/openapi.yaml',
      description: 'OpenAPI 3.0 specification with endpoints, schemas, and auth',
      language: 'yaml',
    },
    {
      kind: 'doc',
      suggestedPath: 'docs/api-guide.md',
      description: 'API usage guide with examples',
    },
  ];

  switch (language) {
    case 'typescript':
    case 'javascript':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: `api/server${ext}`,
          description: `${framework || 'Express'} server setup with middleware`,
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `api/routes/index${ext}`,
          description: 'Route definitions and controllers',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `api/middleware/auth${ext}`,
          description: 'JWT authentication middleware',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `api/middleware/validation${ext}`,
          description: 'Request validation middleware',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `api/middleware/error-handler${ext}`,
          description: 'Global error handling middleware',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `api/controllers/users${ext}`,
          description: 'User CRUD operations',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: language === 'typescript' ? 'api/types/dto.ts' : 'api/types/dto.js',
          description: 'Data transfer objects',
          language: language,
        },
        {
          kind: 'config',
          suggestedPath: 'package.json',
          description: 'Node.js dependencies and scripts',
          language: 'json',
        },
      ];

    case 'python':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'api/main.py',
          description: `${framework || 'FastAPI'} application entry point`,
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'api/routers/__init__.py',
          description: 'Router initialization',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'api/routers/users.py',
          description: 'User endpoint routes',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'api/middleware/auth.py',
          description: 'JWT authentication middleware',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'api/middleware/error_handler.py',
          description: 'Global error handling',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'api/models/schemas.py',
          description: 'Pydantic models for request/response validation',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'api/config.py',
          description: 'Application configuration settings',
          language: 'python',
        },
        {
          kind: 'config',
          suggestedPath: 'requirements.txt',
          description: 'Python package dependencies',
          language: 'text',
        },
        {
          kind: 'config',
          suggestedPath: 'pyproject.toml',
          description: 'Python project configuration',
          language: 'toml',
        },
      ];

    case 'java':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/api/ApiApplication.java',
          description: 'Spring Boot application main class',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/api/controllers/UserController.java',
          description: 'User REST controller',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/api/services/UserService.java',
          description: 'Business logic service',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/api/models/User.java',
          description: 'User entity model',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/api/dto/UserDTO.java',
          description: 'Data transfer objects',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/api/config/SecurityConfig.java',
          description: 'Spring Security configuration',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/api/filters/JwtAuthFilter.java',
          description: 'JWT authentication filter',
          language: 'java',
        },
        {
          kind: 'config',
          suggestedPath: 'pom.xml',
          description: 'Maven project configuration',
          language: 'xml',
        },
        {
          kind: 'config',
          suggestedPath: 'src/main/resources/application.properties',
          description: 'Application configuration properties',
          language: 'properties',
        },
      ];

    case 'go':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'main.go',
          description: 'Application entry point',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/routes/routes.go',
          description: 'HTTP route definitions',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/handlers/users.go',
          description: 'User request handlers',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/middleware/auth.go',
          description: 'JWT authentication middleware',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/middleware/error.go',
          description: 'Error handling middleware',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/models/user.go',
          description: 'User data models',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'pkg/config/config.go',
          description: 'Configuration loader',
          language: 'go',
        },
        {
          kind: 'config',
          suggestedPath: 'go.mod',
          description: 'Go module dependencies',
          language: 'text',
        },
        {
          kind: 'config',
          suggestedPath: 'config.yaml',
          description: 'Application configuration',
          language: 'yaml',
        },
      ];

    case 'csharp':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'Program.cs',
          description: 'ASP.NET Core application entry point',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Controllers/UsersController.cs',
          description: 'User API controller with CRUD endpoints',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Services/UserService.cs',
          description: 'Business logic service layer',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Models/User.cs',
          description: 'User data model',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'DTOs/UserDTO.cs',
          description: 'Data transfer objects',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Middleware/JwtAuthMiddleware.cs',
          description: 'JWT authentication middleware',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Middleware/ErrorHandlerMiddleware.cs',
          description: 'Global error handling middleware',
          language: 'csharp',
        },
        {
          kind: 'config',
          suggestedPath: 'appsettings.json',
          description: 'Application configuration',
          language: 'json',
        },
        {
          kind: 'config',
          suggestedPath: 'Api.csproj',
          description: 'Project file with dependencies',
          language: 'xml',
        },
      ];

    case 'php':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'public/index.php',
          description: 'Application entry point',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Routes/api.php',
          description: 'API route definitions',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Controllers/UserController.php',
          description: 'User CRUD controller',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Services/UserService.php',
          description: 'Business logic service',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Models/User.php',
          description: 'User model',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Middleware/AuthMiddleware.php',
          description: 'JWT authentication middleware',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Middleware/ErrorHandler.php',
          description: 'Error handling middleware',
          language: 'php',
        },
        {
          kind: 'config',
          suggestedPath: 'composer.json',
          description: 'PHP dependencies and autoloader',
          language: 'json',
        },
        {
          kind: 'config',
          suggestedPath: 'config/app.php',
          description: 'Application configuration',
          language: 'php',
        },
      ];

    case 'ruby':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: 'config.ru',
          description: 'Rack application configuration',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/controllers/users_controller.rb',
          description: 'User API controller',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/services/user_service.rb',
          description: 'Business logic service',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/models/user.rb',
          description: 'User model',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/middleware/auth_middleware.rb',
          description: 'JWT authentication middleware',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/middleware/error_handler.rb',
          description: 'Error handling middleware',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'config/routes.rb',
          description: 'API route definitions',
          language: 'ruby',
        },
        {
          kind: 'config',
          suggestedPath: 'Gemfile',
          description: 'Ruby gem dependencies',
          language: 'ruby',
        },
        {
          kind: 'config',
          suggestedPath: 'config/application.rb',
          description: 'Application configuration',
          language: 'ruby',
        },
      ];

    case 'rust':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/main.rs',
          description: 'Application entry point',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/routes/mod.rs',
          description: 'Route module definitions',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/routes/users.rs',
          description: 'User endpoint handlers',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/middleware/auth.rs',
          description: 'JWT authentication middleware',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/middleware/error.rs',
          description: 'Error handling middleware',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/models/user.rs',
          description: 'User data structures',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/config.rs',
          description: 'Configuration management',
          language: 'rust',
        },
        {
          kind: 'config',
          suggestedPath: 'Cargo.toml',
          description: 'Rust project and dependencies',
          language: 'toml',
        },
      ];

    default:
      return common;
  }
}

function generateGraphQLAPIArtifacts(context: LanguageTemplateContext): ArtifactPlaceholder[] {
  const { language } = context;
  const ext = getFileExtensionForLanguage(language);

  const common: ArtifactPlaceholder[] = [
    {
      kind: 'schema',
      suggestedPath: 'graphql/schema.graphql',
      description: 'GraphQL type definitions and schema',
      language: 'graphql',
    },
    {
      kind: 'doc',
      suggestedPath: 'docs/graphql-guide.md',
      description: 'GraphQL API documentation',
    },
  ];

  switch (language) {
    case 'typescript':
    case 'javascript':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: `graphql/server${ext}`,
          description: 'Apollo Server or GraphQL Yoga setup',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `graphql/resolvers/index${ext}`,
          description: 'Root resolver map',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `graphql/resolvers/queries${ext}`,
          description: 'Query resolvers',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `graphql/resolvers/mutations${ext}`,
          description: 'Mutation resolvers',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `graphql/context${ext}`,
          description: 'GraphQL context setup',
          language: language,
        },
      ];

    case 'python':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'graphql/main.py',
          description: 'GraphQL server entry point',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/resolvers/query.py',
          description: 'Query resolvers',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/resolvers/mutation.py',
          description: 'Mutation resolvers',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'graphql/context.py',
          description: 'Request context setup',
          language: 'python',
        },
      ];

    case 'java':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/graphql/GraphQLApplication.java',
          description: 'Spring Boot GraphQL application',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/graphql/resolvers/QueryResolver.java',
          description: 'Query resolver implementation',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/graphql/resolvers/MutationResolver.java',
          description: 'Mutation resolver implementation',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/graphql/models/User.java',
          description: 'GraphQL type models',
          language: 'java',
        },
        {
          kind: 'config',
          suggestedPath: 'pom.xml',
          description: 'Maven dependencies',
          language: 'xml',
        },
      ];

    case 'go':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'main.go',
          description: 'GraphQL server entry point',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/resolvers/query.go',
          description: 'Query resolvers',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/resolvers/mutation.go',
          description: 'Mutation resolvers',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/models/user.go',
          description: 'GraphQL type models',
          language: 'go',
        },
        {
          kind: 'config',
          suggestedPath: 'go.mod',
          description: 'Go module dependencies',
          language: 'text',
        },
      ];

    case 'csharp':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'Program.cs',
          description: 'GraphQL server setup with HotChocolate',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Queries/Query.cs',
          description: 'Query type implementation',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Mutations/Mutation.cs',
          description: 'Mutation type implementation',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Types/User.cs',
          description: 'GraphQL object types',
          language: 'csharp',
        },
        {
          kind: 'config',
          suggestedPath: 'GraphQL.csproj',
          description: 'Project configuration',
          language: 'xml',
        },
      ];

    case 'php':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'public/index.php',
          description: 'GraphQL endpoint',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Types/QueryType.php',
          description: 'Query type definition',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Types/MutationType.php',
          description: 'Mutation type definition',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Types/UserType.php',
          description: 'User object type',
          language: 'php',
        },
        {
          kind: 'config',
          suggestedPath: 'composer.json',
          description: 'PHP dependencies',
          language: 'json',
        },
      ];

    case 'ruby':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'app/graphql/schema.rb',
          description: 'GraphQL schema definition',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/graphql/types/query_type.rb',
          description: 'Query type',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/graphql/types/mutation_type.rb',
          description: 'Mutation type',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/graphql/types/user_type.rb',
          description: 'User object type',
          language: 'ruby',
        },
        {
          kind: 'config',
          suggestedPath: 'Gemfile',
          description: 'Ruby gem dependencies',
          language: 'ruby',
        },
      ];

    case 'rust':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/main.rs',
          description: 'GraphQL server with async-graphql',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/schema/query.rs',
          description: 'Query root implementation',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/schema/mutation.rs',
          description: 'Mutation root implementation',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/models/user.rs',
          description: 'GraphQL object types',
          language: 'rust',
        },
        {
          kind: 'config',
          suggestedPath: 'Cargo.toml',
          description: 'Rust project dependencies',
          language: 'toml',
        },
      ];

    default:
      return common;
  }
}

function generateGRPCServiceArtifacts(context: LanguageTemplateContext): ArtifactPlaceholder[] {
  const { language } = context;
  const ext = getFileExtensionForLanguage(language);

  const common: ArtifactPlaceholder[] = [
    {
      kind: 'schema',
      suggestedPath: 'proto/service.proto',
      description: 'Protocol Buffer service definitions',
      language: 'protobuf',
    },
    {
      kind: 'doc',
      suggestedPath: 'docs/grpc-guide.md',
      description: 'gRPC service documentation',
    },
  ];

  switch (language) {
    case 'typescript':
    case 'javascript':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: `grpc/server${ext}`,
          description: 'gRPC server implementation',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `grpc/handlers/index${ext}`,
          description: 'Service method handlers',
          language: language,
        },
      ];

    case 'go':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'main.go',
          description: 'gRPC server entry point',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/server/server.go',
          description: 'Server implementation',
          language: 'go',
        },
      ];

    case 'python':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'grpc_server/main.py',
          description: 'gRPC server entry point',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'grpc_server/servicer.py',
          description: 'Service implementation',
          language: 'python',
        },
      ];

    case 'java':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/grpc/GrpcServer.java',
          description: 'gRPC server main class',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/grpc/services/UserServiceImpl.java',
          description: 'Service implementation',
          language: 'java',
        },
        {
          kind: 'config',
          suggestedPath: 'pom.xml',
          description: 'Maven dependencies with gRPC',
          language: 'xml',
        },
      ];

    case 'csharp':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'Program.cs',
          description: 'gRPC server entry point',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Services/UserService.cs',
          description: 'Service implementation',
          language: 'csharp',
        },
        {
          kind: 'config',
          suggestedPath: 'GrpcService.csproj',
          description: 'Project configuration',
          language: 'xml',
        },
      ];

    case 'rust':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/main.rs',
          description: 'gRPC server with tonic',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/service.rs',
          description: 'Service implementation',
          language: 'rust',
        },
        {
          kind: 'config',
          suggestedPath: 'Cargo.toml',
          description: 'Rust dependencies with tonic',
          language: 'toml',
        },
        {
          kind: 'config',
          suggestedPath: 'build.rs',
          description: 'Build script for protobuf compilation',
          language: 'rust',
        },
      ];

    case 'php':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/Server.php',
          description: 'gRPC server implementation',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Services/UserService.php',
          description: 'Service implementation',
          language: 'php',
        },
        {
          kind: 'config',
          suggestedPath: 'composer.json',
          description: 'PHP dependencies with gRPC',
          language: 'json',
        },
      ];

    case 'ruby':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'server.rb',
          description: 'gRPC server entry point',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'services/user_service.rb',
          description: 'Service implementation',
          language: 'ruby',
        },
        {
          kind: 'config',
          suggestedPath: 'Gemfile',
          description: 'Ruby gem dependencies with gRPC',
          language: 'ruby',
        },
      ];

    default:
      return common;
  }
}

function generateAuthServiceArtifacts(context: LanguageTemplateContext): ArtifactPlaceholder[] {
  const { language, nodeTypeId } = context;
  const ext = getFileExtensionForLanguage(language);

  const provider = nodeTypeId.replace('auth.', '');
  const providerConfig = getAuthProviderConfig(provider);

  const common: ArtifactPlaceholder[] = [
    {
      kind: 'doc',
      suggestedPath: 'docs/auth-setup.md',
      description: `${providerConfig.name} setup and configuration guide`,
    },
    {
      kind: 'doc',
      suggestedPath: 'docs/auth-flows.md',
      description: 'Authentication flow diagrams and examples',
    },
  ];

  switch (language) {
    case 'typescript':
    case 'javascript':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: providerConfig.configFile,
          description: `${providerConfig.name} configuration`,
          language: providerConfig.configLanguage,
        },
        {
          kind: 'source',
          suggestedPath: `auth/client${ext}`,
          description: `${providerConfig.name} client initialization`,
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `auth/hooks/useAuth${ext}`,
          description: 'React hook for authentication state',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `auth/context/AuthContext${ext}`,
          description: 'Auth context provider for React',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `auth/middleware/requireAuth${ext}`,
          description: 'Server-side auth middleware',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `auth/middleware/verifyToken${ext}`,
          description: 'JWT/token verification middleware',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `auth/utils/session${ext}`,
          description: 'Session management utilities',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: language === 'typescript' ? 'auth/types/user.ts' : 'auth/types/user.js',
          description: 'User and auth type definitions',
          language: language,
        },
        ...providerConfig.extraFiles.map(file => ({
          kind: 'source' as const,
          suggestedPath: file.path,
          description: file.description,
          language: language,
        })),
      ];

    case 'python':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: providerConfig.configFile,
          description: `${providerConfig.name} configuration`,
          language: providerConfig.configLanguage,
        },
        {
          kind: 'source',
          suggestedPath: 'auth/client.py',
          description: `${providerConfig.name} client setup`,
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'auth/middleware/auth_middleware.py',
          description: 'Authentication middleware',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'auth/middleware/jwt_handler.py',
          description: 'JWT token verification',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'auth/decorators/require_auth.py',
          description: 'Route authentication decorator',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'auth/models/user.py',
          description: 'User model with auth fields',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'auth/utils/session.py',
          description: 'Session management utilities',
          language: 'python',
        },
        {
          kind: 'config',
          suggestedPath: '.env.example',
          description: `${providerConfig.name} environment variables template`,
          language: 'text',
        },
      ];

    case 'go':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: providerConfig.configFile,
          description: `${providerConfig.name} configuration`,
          language: providerConfig.configLanguage,
        },
        {
          kind: 'source',
          suggestedPath: 'internal/auth/client.go',
          description: `${providerConfig.name} client initialization`,
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/auth/middleware.go',
          description: 'Authentication middleware',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/auth/jwt.go',
          description: 'JWT token verification',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/auth/session.go',
          description: 'Session management',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/models/user.go',
          description: 'User model with auth fields',
          language: 'go',
        },
        {
          kind: 'config',
          suggestedPath: 'config.yaml',
          description: 'Application configuration with auth settings',
          language: 'yaml',
        },
      ];

    case 'java':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: 'src/main/resources/application.properties',
          description: `${providerConfig.name} configuration properties`,
          language: 'properties',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/auth/config/AuthConfig.java',
          description: 'Auth configuration class',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/auth/filters/JwtAuthFilter.java',
          description: 'JWT authentication filter',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/auth/services/AuthService.java',
          description: 'Authentication service',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/auth/services/TokenService.java',
          description: 'Token verification service',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/auth/models/User.java',
          description: 'User entity with auth fields',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/auth/controllers/AuthController.java',
          description: 'Authentication endpoints',
          language: 'java',
        },
      ];

    case 'csharp':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: 'appsettings.json',
          description: `${providerConfig.name} configuration settings`,
          language: 'json',
        },
        {
          kind: 'source',
          suggestedPath: 'Auth/AuthClient.cs',
          description: `${providerConfig.name} client initialization`,
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Auth/Middleware/JwtAuthMiddleware.cs',
          description: 'JWT authentication middleware',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Auth/Services/AuthService.cs',
          description: 'Authentication service',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Auth/Services/TokenService.cs',
          description: 'Token verification and generation',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Auth/Models/User.cs',
          description: 'User model with auth properties',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Auth/Controllers/AuthController.cs',
          description: 'Authentication API endpoints',
          language: 'csharp',
        },
        {
          kind: 'config',
          suggestedPath: 'Auth.csproj',
          description: 'Project file with auth dependencies',
          language: 'xml',
        },
      ];

    case 'php':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: providerConfig.configFile,
          description: `${providerConfig.name} configuration`,
          language: providerConfig.configLanguage,
        },
        {
          kind: 'source',
          suggestedPath: 'src/Auth/AuthClient.php',
          description: `${providerConfig.name} client initialization`,
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Auth/Middleware/AuthMiddleware.php',
          description: 'Authentication middleware',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Auth/Middleware/JwtMiddleware.php',
          description: 'JWT token verification middleware',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Auth/Services/AuthService.php',
          description: 'Authentication service class',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Auth/Models/User.php',
          description: 'User model with auth fields',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Auth/Utils/SessionManager.php',
          description: 'Session management utilities',
          language: 'php',
        },
        {
          kind: 'config',
          suggestedPath: 'composer.json',
          description: `PHP dependencies with ${providerConfig.name} SDK`,
          language: 'json',
        },
      ];

    case 'ruby':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: providerConfig.configFile,
          description: `${providerConfig.name} configuration`,
          language: providerConfig.configLanguage,
        },
        {
          kind: 'source',
          suggestedPath: 'lib/auth/client.rb',
          description: `${providerConfig.name} client initialization`,
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/auth/middleware/auth_middleware.rb',
          description: 'Rack authentication middleware',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/auth/services/token_service.rb',
          description: 'JWT token verification service',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/auth/services/auth_service.rb',
          description: 'Authentication service',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'app/models/user.rb',
          description: 'User model with authentication',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/auth/session_manager.rb',
          description: 'Session management utilities',
          language: 'ruby',
        },
        {
          kind: 'config',
          suggestedPath: 'Gemfile',
          description: `Ruby gems with ${providerConfig.name} SDK`,
          language: 'ruby',
        },
      ];

    case 'rust':
      return [
        ...common,
        {
          kind: 'config',
          suggestedPath: providerConfig.configFile,
          description: `${providerConfig.name} configuration`,
          language: providerConfig.configLanguage,
        },
        {
          kind: 'source',
          suggestedPath: 'src/auth/client.rs',
          description: `${providerConfig.name} client initialization`,
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/auth/middleware.rs',
          description: 'Authentication middleware',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/auth/jwt.rs',
          description: 'JWT token verification',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/auth/service.rs',
          description: 'Authentication service implementation',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/models/user.rs',
          description: 'User struct with auth fields',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/auth/session.rs',
          description: 'Session management',
          language: 'rust',
        },
        {
          kind: 'config',
          suggestedPath: 'Cargo.toml',
          description: `Rust dependencies with ${providerConfig.name} crates`,
          language: 'toml',
        },
      ];

    default:
      return common;
  }
}

function generateCacheServiceArtifacts(context: LanguageTemplateContext): ArtifactPlaceholder[] {
  const { language, nodeTypeId } = context;
  const ext = getFileExtensionForLanguage(language);

  const cacheType = nodeTypeId.replace('cache.', '');
  const cacheConfig = getCacheConfig(cacheType);

  const common: ArtifactPlaceholder[] = [
    {
      kind: 'doc',
      suggestedPath: 'docs/cache-strategy.md',
      description: `${cacheConfig.name} caching strategy and patterns`,
    },
    {
      kind: 'config',
      suggestedPath: cacheConfig.configFile,
      description: `${cacheConfig.name} connection and configuration`,
      language: cacheConfig.configLanguage,
    },
  ];

  switch (language) {
    case 'typescript':
    case 'javascript':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: `cache/client${ext}`,
          description: `${cacheConfig.name} client initialization with connection pooling`,
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `cache/manager${ext}`,
          description: 'Cache manager with get/set/delete operations',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `cache/strategies/cache-aside${ext}`,
          description: 'Cache-aside (lazy loading) pattern implementation',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `cache/strategies/write-through${ext}`,
          description: 'Write-through caching pattern',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `cache/middleware/cache-middleware${ext}`,
          description: 'HTTP response caching middleware',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `cache/utils/key-builder${ext}`,
          description: 'Cache key generation utilities',
          language: language,
        },
        {
          kind: 'source',
          suggestedPath: `cache/utils/serializer${ext}`,
          description: 'Data serialization/deserialization for cache',
          language: language,
        },
        ...cacheConfig.extraFiles.map(file => ({
          kind: 'source' as const,
          suggestedPath: file.path,
          description: file.description,
          language: language,
        })),
        {
          kind: 'source',
          suggestedPath: language === 'typescript' ? 'cache/types/cache.ts' : 'cache/types/cache.js',
          description: 'Cache configuration types',
          language: language,
        },
      ];

    case 'python':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'cache/client.py',
          description: `${cacheConfig.name} client with connection pool`,
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'cache/manager.py',
          description: 'Cache manager class',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'cache/decorators/cached.py',
          description: 'Function result caching decorator',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'cache/strategies/cache_aside.py',
          description: 'Cache-aside pattern implementation',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'cache/strategies/write_through.py',
          description: 'Write-through caching strategy',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'cache/utils/key_builder.py',
          description: 'Cache key generation',
          language: 'python',
        },
        {
          kind: 'source',
          suggestedPath: 'cache/utils/serializer.py',
          description: 'JSON/Pickle serialization',
          language: 'python',
        },
        {
          kind: 'config',
          suggestedPath: 'requirements.txt',
          description: `${cacheConfig.name} Python package`,
          language: 'text',
        },
      ];

    case 'go':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'internal/cache/client.go',
          description: `${cacheConfig.name} client initialization`,
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/cache/manager.go',
          description: 'Cache manager interface',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/cache/strategies/cache_aside.go',
          description: 'Cache-aside pattern',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/cache/middleware/cache.go',
          description: 'HTTP caching middleware',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/cache/utils/keys.go',
          description: 'Cache key utilities',
          language: 'go',
        },
        {
          kind: 'source',
          suggestedPath: 'internal/cache/serializer.go',
          description: 'Data serialization',
          language: 'go',
        },
        {
          kind: 'config',
          suggestedPath: 'go.mod',
          description: `Go module with ${cacheConfig.name} dependency`,
          language: 'text',
        },
      ];

    case 'java':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/cache/config/CacheConfig.java',
          description: `${cacheConfig.name} Spring configuration`,
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/cache/CacheManager.java',
          description: 'Cache manager service',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/cache/strategies/CacheAside.java',
          description: 'Cache-aside pattern',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/cache/strategies/WriteThrough.java',
          description: 'Write-through strategy',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/cache/utils/KeyBuilder.java',
          description: 'Cache key generation',
          language: 'java',
        },
        {
          kind: 'source',
          suggestedPath: 'src/main/java/com/example/cache/serializers/JsonSerializer.java',
          description: 'JSON serialization for cache',
          language: 'java',
        },
        {
          kind: 'config',
          suggestedPath: 'pom.xml',
          description: `Maven dependency for ${cacheConfig.name}`,
          language: 'xml',
        },
      ];

    case 'csharp':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'Cache/CacheClient.cs',
          description: `${cacheConfig.name} client with connection pooling`,
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Cache/CacheManager.cs',
          description: 'Cache manager service',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Cache/Strategies/CacheAsideStrategy.cs',
          description: 'Cache-aside pattern implementation',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Cache/Strategies/WriteThroughStrategy.cs',
          description: 'Write-through caching strategy',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Cache/Middleware/CacheMiddleware.cs',
          description: 'HTTP response caching middleware',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Cache/Utils/KeyBuilder.cs',
          description: 'Cache key generation utilities',
          language: 'csharp',
        },
        {
          kind: 'source',
          suggestedPath: 'Cache/Serializers/JsonSerializer.cs',
          description: 'JSON serialization for cache',
          language: 'csharp',
        },
        {
          kind: 'config',
          suggestedPath: 'Cache.csproj',
          description: `Project file with ${cacheConfig.name} dependencies`,
          language: 'xml',
        },
      ];

    case 'php':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/Cache/CacheClient.php',
          description: `${cacheConfig.name} client with connection pooling`,
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Cache/CacheManager.php',
          description: 'Cache manager class',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Cache/Strategies/CacheAsideStrategy.php',
          description: 'Cache-aside pattern implementation',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Cache/Strategies/WriteThroughStrategy.php',
          description: 'Write-through caching strategy',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Cache/Middleware/CacheMiddleware.php',
          description: 'PSR-15 caching middleware',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Cache/Utils/KeyBuilder.php',
          description: 'Cache key generation utilities',
          language: 'php',
        },
        {
          kind: 'source',
          suggestedPath: 'src/Cache/Serializers/JsonSerializer.php',
          description: 'JSON serialization for cache',
          language: 'php',
        },
        {
          kind: 'config',
          suggestedPath: 'composer.json',
          description: `PHP dependencies with ${cacheConfig.name} client`,
          language: 'json',
        },
      ];

    case 'ruby':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'lib/cache/client.rb',
          description: `${cacheConfig.name} client with connection pooling`,
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/cache/manager.rb',
          description: 'Cache manager class',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/cache/strategies/cache_aside.rb',
          description: 'Cache-aside pattern implementation',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/cache/strategies/write_through.rb',
          description: 'Write-through caching strategy',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/cache/middleware/cache_middleware.rb',
          description: 'Rack caching middleware',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/cache/utils/key_builder.rb',
          description: 'Cache key generation utilities',
          language: 'ruby',
        },
        {
          kind: 'source',
          suggestedPath: 'lib/cache/serializers/json_serializer.rb',
          description: 'JSON serialization for cache',
          language: 'ruby',
        },
        {
          kind: 'config',
          suggestedPath: 'Gemfile',
          description: `Ruby gems with ${cacheConfig.name} client`,
          language: 'ruby',
        },
      ];

    case 'rust':
      return [
        ...common,
        {
          kind: 'source',
          suggestedPath: 'src/cache/client.rs',
          description: `${cacheConfig.name} client with connection pooling`,
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/cache/manager.rs',
          description: 'Cache manager trait and implementation',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/cache/strategies/cache_aside.rs',
          description: 'Cache-aside pattern implementation',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/cache/strategies/write_through.rs',
          description: 'Write-through caching strategy',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/cache/middleware.rs',
          description: 'Tower/Axum caching middleware',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/cache/utils/key_builder.rs',
          description: 'Cache key generation utilities',
          language: 'rust',
        },
        {
          kind: 'source',
          suggestedPath: 'src/cache/serializer.rs',
          description: 'Serde serialization for cache',
          language: 'rust',
        },
        {
          kind: 'config',
          suggestedPath: 'Cargo.toml',
          description: `Rust dependencies with ${cacheConfig.name} crates`,
          language: 'toml',
        },
      ];

    default:
      return common;
  }
}

function getAuthProviderConfig(provider: string) {
  const configs: Record<string, {
    name: string;
    configFile: string;
    configLanguage: string;
    extraFiles: Array<{ path: string; description: string }>;
  }> = {
    'supabase-auth': {
      name: 'Supabase Auth',
      configFile: '.env',
      configLanguage: 'text',
      extraFiles: [
        { path: 'auth/providers/supabase.ts', description: 'Supabase-specific auth helpers' },
        { path: 'auth/policies/rls.sql', description: 'Row Level Security policies' },
      ],
    },
    'auth0': {
      name: 'Auth0',
      configFile: 'auth0.config.json',
      configLanguage: 'json',
      extraFiles: [
        { path: 'auth/providers/auth0.ts', description: 'Auth0 SDK integration' },
        { path: 'auth/callbacks/auth0-callback.ts', description: 'OAuth callback handler' },
      ],
    },
    'aws-cognito': {
      name: 'AWS Cognito',
      configFile: 'aws-cognito.config.json',
      configLanguage: 'json',
      extraFiles: [
        { path: 'auth/providers/cognito.ts', description: 'Cognito SDK wrapper' },
        { path: 'auth/lambdas/pre-signup.ts', description: 'Pre-signup Lambda trigger' },
        { path: 'auth/lambdas/post-confirmation.ts', description: 'Post-confirmation Lambda trigger' },
      ],
    },
    'keycloak': {
      name: 'Keycloak',
      configFile: 'keycloak.json',
      configLanguage: 'json',
      extraFiles: [
        { path: 'auth/providers/keycloak.ts', description: 'Keycloak adapter configuration' },
        { path: 'auth/realms/realm-config.json', description: 'Realm configuration export' },
      ],
    },
    'firebase-auth': {
      name: 'Firebase Auth',
      configFile: 'firebase.config.json',
      configLanguage: 'json',
      extraFiles: [
        { path: 'auth/providers/firebase.ts', description: 'Firebase SDK initialization' },
        { path: 'auth/rules/firestore.rules', description: 'Firestore security rules' },
      ],
    },
    'azure-ad-b2c': {
      name: 'Azure AD B2C',
      configFile: 'azure-ad-b2c.config.json',
      configLanguage: 'json',
      extraFiles: [
        { path: 'auth/providers/azure-ad.ts', description: 'MSAL configuration' },
        { path: 'auth/policies/custom-policy.xml', description: 'Custom policy definition' },
      ],
    },
  };

  return configs[provider] || {
    name: 'Auth Service',
    configFile: '.env',
    configLanguage: 'text',
    extraFiles: [],
  };
}

function getCacheConfig(cacheType: string) {
  const configs: Record<string, {
    name: string;
    configFile: string;
    configLanguage: string;
    extraFiles: Array<{ path: string; description: string }>;
  }> = {
    'redis': {
      name: 'Redis',
      configFile: 'redis.conf',
      configLanguage: 'text',
      extraFiles: [
        { path: 'cache/redis/pub-sub.ts', description: 'Redis pub/sub implementation' },
        { path: 'cache/redis/streams.ts', description: 'Redis Streams event sourcing' },
        { path: 'cache/redis/cluster.ts', description: 'Redis Cluster configuration' },
      ],
    },
    'memcached': {
      name: 'Memcached',
      configFile: '.env',
      configLanguage: 'text',
      extraFiles: [
        { path: 'cache/memcached/consistent-hash.ts', description: 'Consistent hashing implementation' },
      ],
    },
    'valkey': {
      name: 'Valkey',
      configFile: 'valkey.conf',
      configLanguage: 'text',
      extraFiles: [
        { path: 'cache/valkey/migration.ts', description: 'Redis to Valkey migration helpers' },
      ],
    },
    'elasticache': {
      name: 'AWS ElastiCache',
      configFile: '.env',
      configLanguage: 'text',
      extraFiles: [
        { path: 'cache/elasticache/cluster-discovery.ts', description: 'ElastiCache cluster endpoint discovery' },
        { path: 'cache/elasticache/auto-scaling.ts', description: 'Auto-scaling configuration' },
      ],
    },
    'cloudflare-kv': {
      name: 'Cloudflare KV',
      configFile: 'wrangler.toml',
      configLanguage: 'toml',
      extraFiles: [
        { path: 'cache/kv/worker.ts', description: 'Cloudflare Worker with KV integration' },
        { path: 'cache/kv/bulk-operations.ts', description: 'Bulk read/write operations' },
      ],
    },
  };

  return configs[cacheType] || {
    name: 'Cache Service',
    configFile: '.env',
    configLanguage: 'text',
    extraFiles: [],
  };
}

function generateAWSAPIGatewayArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'api-gateway.yaml',
      description: 'AWS API Gateway OpenAPI/Swagger specification',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'authorizer.json',
      description: 'Custom Lambda authorizer configuration',
      language: 'json',
    },
    {
      kind: 'config',
      suggestedPath: 'usage-plan.json',
      description: 'API usage plan with throttling and quotas',
      language: 'json',
    },
  ];
}

function generateAzureAPIMgmtArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'apim-policy.xml',
      description: 'Azure APIM policy configuration',
      language: 'xml',
    },
    {
      kind: 'config',
      suggestedPath: 'api-definition.json',
      description: 'OpenAPI specification for backend APIs',
      language: 'json',
    },
  ];
}

function generateGCPAPIGatewayArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'openapi.yaml',
      description: 'OpenAPI specification for GCP API Gateway',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'gateway-config.yaml',
      description: 'Gateway configuration with authentication',
      language: 'yaml',
    },
  ];
}

function generateKongGatewayArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'kong.yaml',
      description: 'Kong declarative configuration',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'plugins/rate-limiting.yaml',
      description: 'Rate limiting plugin configuration',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'plugins/jwt-auth.yaml',
      description: 'JWT authentication plugin',
      language: 'yaml',
    },
  ];
}

function generateAWSLoadBalancerArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'target-group.json',
      description: 'ALB/NLB target group configuration',
      language: 'json',
    },
    {
      kind: 'config',
      suggestedPath: 'listener-rules.json',
      description: 'Listener rules for routing',
      language: 'json',
    },
    {
      kind: 'config',
      suggestedPath: 'health-check.json',
      description: 'Health check configuration',
      language: 'json',
    },
  ];
}

function generateAzureLoadBalancerArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'backend-pool.json',
      description: 'Backend pool configuration',
      language: 'json',
    },
    {
      kind: 'config',
      suggestedPath: 'health-probe.json',
      description: 'Health probe settings',
      language: 'json',
    },
    {
      kind: 'config',
      suggestedPath: 'load-balancing-rules.json',
      description: 'Load balancing and NAT rules',
      language: 'json',
    },
  ];
}

function generateGCPLoadBalancerArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'backend-service.yaml',
      description: 'GCP backend service configuration',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'health-check.yaml',
      description: 'Health check configuration',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'url-map.yaml',
      description: 'URL map for routing rules',
      language: 'yaml',
    },
  ];
}

function generateNginxLoadBalancerArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'nginx.conf',
      description: 'Nginx main configuration',
      language: 'text',
    },
    {
      kind: 'config',
      suggestedPath: 'conf.d/upstream.conf',
      description: 'Upstream backend pool configuration',
      language: 'text',
    },
    {
      kind: 'config',
      suggestedPath: 'conf.d/proxy.conf',
      description: 'Proxy and load balancing settings',
      language: 'text',
    },
    {
      kind: 'config',
      suggestedPath: 'ssl/ssl.conf',
      description: 'SSL/TLS configuration',
      language: 'text',
    },
  ];
}

function generateHAProxyLoadBalancerArtifacts(_context: LanguageTemplateContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'haproxy.cfg',
      description: 'HAProxy main configuration',
      language: 'text',
    },
    {
      kind: 'config',
      suggestedPath: 'backends.cfg',
      description: 'Backend server configuration',
      language: 'text',
    },
    {
      kind: 'config',
      suggestedPath: 'health-checks.cfg',
      description: 'Health check configuration',
      language: 'text',
    },
  ];
}

export function mergeArtifactPlaceholders(
  defaultPlaceholders: ArtifactPlaceholder[],
  languageSpecificPlaceholders: ArtifactPlaceholder[]
): ArtifactPlaceholder[] {
  if (languageSpecificPlaceholders.length === 0) {
    return defaultPlaceholders;
  }

  return languageSpecificPlaceholders;
}
