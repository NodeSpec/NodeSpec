import { describe, it, expect, afterEach } from 'vitest';
import {
  buildSystemContext,
  formatSystemContextForAI,
  formatNodeTypeDetailsForAI,
  getNodeTypeById,
} from '@nodespec/core/generation/system-context.js';
import {
  parseAIResponse,
  validateParsedArchitecture,
  applyLayoutToNodes,
} from '@nodespec/core/generation/response-parser.js';
import { populateDomains, type NodeTypeDomain } from '@nodespec/core/node-types.js';
import type { Node } from '@nodespec/core/types.js';

// N9b-3: the static node-type registry is retired — domains are DB-hydrated via
// populateDomains(), and before hydration every lookup is empty/undefined. These
// tests pin the LIVE registry contract using a hydrated fixture domain.
const FIXTURE_DOMAINS: NodeTypeDomain[] = [
  {
    id: 'software',
    label: 'Software',
    description: 'Software components',
    icon: 'code',
    nodeTypes: [
      {
        id: 'frontend-app',
        label: 'React App',
        domain: 'software',
        description: 'Browser-delivered user interface',
        icon: 'monitor',
        color: '#61dafb',
        aiContext: {
          purpose: 'Render the user interface',
          typicalTech: ['react', 'vite'],
          bestPractices: ['Keep components small'],
          antiPatterns: ['Direct database access from the browser'],
        },
      },
      {
        id: 'backend-service',
        label: 'Backend Service',
        domain: 'software',
        description: 'Server-side application service',
        icon: 'server',
        color: '#3c873a',
        aiContext: {
          purpose: 'Serve APIs and business logic',
          typicalTech: ['nodejs', 'express'],
          bestPractices: ['Single responsibility'],
          antiPatterns: ['God services'],
        },
      },
    ],
  },
];

describe('System Context Builder', () => {
  afterEach(() => {
    populateDomains([]);
  });

  it('should build system context with no node types before catalog hydration', () => {
    const context = buildSystemContext();

    expect(context.availableNodeTypes).toEqual([]);
  });

  it('should build system context from hydrated catalog domains', () => {
    populateDomains(FIXTURE_DOMAINS);
    const context = buildSystemContext();

    expect(context.availableNodeTypes).toContain('frontend-app');
    expect(context.availableNodeTypes).toContain('backend-service');
    expect(context.nodeTypeDescriptions['frontend-app']).toContain('React App');
  });

  it('should include all contract kinds', () => {
    const context = buildSystemContext();

    // N8.6: unified 12-kind contract vocabulary (legacy 'event_stream' -> kafka,
    // 'message_queue' -> amqp).
    expect(context.availableContractKinds).toContain('rest');
    expect(context.availableContractKinds).toContain('graphql');
    expect(context.availableContractKinds).toContain('websocket');
    expect(context.availableContractKinds).toContain('kafka');
    expect(context.availableContractKinds).toContain('amqp');
    expect(context.availableContractKinds).not.toContain('event_stream');
    expect(context.availableContractKinds).not.toContain('message_queue');
    expect(context.availableContractKinds).toHaveLength(12);
  });

  it('should format system context for AI prompt', () => {
    const context = buildSystemContext();
    const formatted = formatSystemContextForAI(context);

    expect(formatted).toContain('## Available Component Types');
    expect(formatted).toContain('## Connection Types (Contracts)');
    expect(formatted).toContain('## Common Architecture Patterns');
    expect(formatted).toContain('## Best Practices');
  });

  it('should format node type details', () => {
    populateDomains(FIXTURE_DOMAINS);
    const details = formatNodeTypeDetailsForAI('frontend-app');

    expect(details).toContain('React App');
    expect(details).toContain('Best Practices');
    expect(details).toContain('Anti-Patterns to Avoid');
  });

  it('should report unknown node types in details formatting', () => {
    const details = formatNodeTypeDetailsForAI('frontend.react');

    expect(details).toContain('not found in system');
  });

  it('should retrieve node type by ID', () => {
    populateDomains(FIXTURE_DOMAINS);
    const nodeType = getNodeTypeById('frontend-app');

    expect(nodeType).toBeDefined();
    expect(nodeType?.label).toBe('React App');
    expect(nodeType?.aiContext).toBeDefined();
  });
});

describe('AI Response Parser', () => {
  it('should parse valid AI response for simple todo app', () => {
    const aiResponse = `\`\`\`json
{
  "understanding": "User wants a todo app with React frontend, Node.js backend, and PostgreSQL database",
  "nodes": [
    {
      "nodeInfo": {
        "type": "frontend.react",
        "label": "Todo Frontend",
        "description": "React application for managing todos"
      },
      "ports": [
        {
          "name": "API Calls",
          "direction": "out"
        }
      ],
      "artifacts": [
        {
          "path": "src/App.tsx",
          "kind": "source",
          "content": "import React from 'react';\\n\\nfunction App() {\\n  return <div>Todo App</div>;\\n}\\n\\nexport default App;"
        },
        {
          "path": "package.json",
          "kind": "config",
          "content": "{\\"name\\": \\"todo-frontend\\", \\"version\\": \\"1.0.0\\"}"
        }
      ]
    },
    {
      "nodeInfo": {
        "type": "web.rest-api",
        "label": "Todo API",
        "description": "REST API for todo operations"
      },
      "ports": [
        {
          "name": "HTTP Requests",
          "direction": "in"
        },
        {
          "name": "Database Queries",
          "direction": "out"
        }
      ],
      "artifacts": [
        {
          "path": "src/index.ts",
          "kind": "source",
          "content": "import express from 'express';\\n\\nconst app = express();\\napp.listen(3000);"
        }
      ]
    },
    {
      "nodeInfo": {
        "type": "data.postgres",
        "label": "Todo Database",
        "description": "PostgreSQL database for storing todos"
      },
      "ports": [
        {
          "name": "SQL Queries",
          "direction": "in"
        }
      ],
      "artifacts": [
        {
          "path": "schema.sql",
          "kind": "schema",
          "content": "CREATE TABLE todos (id SERIAL PRIMARY KEY, title TEXT NOT NULL, completed BOOLEAN DEFAULT FALSE);"
        }
      ]
    }
  ],
  "edges": [
    {
      "sourceLabel": "Todo Frontend",
      "targetLabel": "Todo API",
      "contractName": "REST API Contract"
    },
    {
      "sourceLabel": "Todo API",
      "targetLabel": "Todo Database",
      "contractName": "Database Contract"
    }
  ],
  "contracts": [
    {
      "name": "REST API Contract",
      "kind": "rest",
      "description": "HTTP REST API for todo operations"
    },
    {
      "name": "Database Contract",
      "kind": "data_flow",
      "description": "SQL queries to PostgreSQL"
    }
  ],
  "warnings": [],
  "recommendations": ["Consider adding authentication", "Add caching layer"]
}
\`\`\``;

    const result = parseAIResponse(aiResponse);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.nodes).toHaveLength(3);
    expect(result.data!.edges).toHaveLength(2);
    expect(result.data!.contracts).toHaveLength(2);
    expect(result.data!.understanding).toContain('todo app');
  });

  it('should fail to parse invalid JSON', () => {
    const aiResponse = 'This is not valid JSON';

    const result = parseAIResponse(aiResponse);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('INVALID_JSON');
  });

  it('should fail to parse response with missing required fields', () => {
    const aiResponse = `\`\`\`json
{
  "understanding": "Test",
  "nodes": [],
  "edges": []
}
\`\`\``;

    const result = parseAIResponse(aiResponse);

    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('SCHEMA_VALIDATION_FAILED');
  });

  it('should validate parsed architecture successfully', () => {
    const parsed = {
      understanding: 'Test architecture',
      nodes: [
        {
          node: {
            id: 'node-1',
            type: 'frontend.react',
            label: 'Frontend',
            ports: [],
            artifacts: [],
            metadata: { position: { x: 0, y: 0 } },
          },
          artifacts: [],
        },
      ],
      edges: [],
      contracts: [],
      schemaArtifacts: [],
      warnings: [],
      recommendations: [],
    };

    const result = validateParsedArchitecture(parsed);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect architecture with no nodes', () => {
    const parsed = {
      understanding: 'Empty architecture',
      nodes: [],
      edges: [],
      contracts: [],
      schemaArtifacts: [],
      warnings: [],
      recommendations: [],
    };

    const result = validateParsedArchitecture(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'NO_NODES')).toBe(true);
  });

  it('should detect invalid edge references', () => {
    const parsed = {
      understanding: 'Test',
      nodes: [
        {
          node: {
            id: 'node-1',
            type: 'frontend.react',
            label: 'Frontend',
            ports: [],
            artifacts: [],
            metadata: { position: { x: 0, y: 0 } },
          },
          artifacts: [],
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'node-1',
          target: 'non-existent-node',
          contractId: 'contract-1',
          metadata: {},
        },
      ],
      contracts: [
        {
          id: 'contract-1',
          name: 'Test Contract',
          kind: 'rest' as const,
          metadata: {},
        },
      ],
      schemaArtifacts: [],
      warnings: [],
      recommendations: [],
    };

    const result = validateParsedArchitecture(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_EDGE_TARGET')).toBe(true);
  });

  it('should warn on unknown node types', () => {
    const parsed = {
      understanding: 'Test',
      nodes: [
        {
          node: {
            id: 'node-1',
            type: 'unknown.type',
            label: 'Unknown Node',
            ports: [],
            artifacts: [],
            metadata: { position: { x: 0, y: 0 } },
          },
          artifacts: [],
        },
      ],
      edges: [],
      contracts: [],
      schemaArtifacts: [],
      warnings: [],
      recommendations: [],
    };

    const result = validateParsedArchitecture(parsed);

    expect(result.valid).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.some(w => w.includes('custom type'))).toBe(true);
  });
});

describe('Layout Application', () => {
  it('should apply grid layout to nodes', () => {
    const nodes: Node[] = [
      {
        id: 'node-1',
        type: 'frontend.react',
        label: 'Node 1',
        ports: [],
        artifacts: [],
        metadata: { position: { x: 0, y: 0 } },
      },
      {
        id: 'node-2',
        type: 'web.rest-api',
        label: 'Node 2',
        ports: [],
        artifacts: [],
        metadata: { position: { x: 0, y: 0 } },
      },
      {
        id: 'node-3',
        type: 'data.postgres',
        label: 'Node 3',
        ports: [],
        artifacts: [],
        metadata: { position: { x: 0, y: 0 } },
      },
    ];

    const layoutNodes = applyLayoutToNodes(nodes);

    expect((layoutNodes[0].metadata as any).position.x).toBe(100);
    expect((layoutNodes[0].metadata as any).position.y).toBe(100);

    expect((layoutNodes[1].metadata as any).position.x).toBe(450);
    expect((layoutNodes[1].metadata as any).position.y).toBe(100);

    expect((layoutNodes[2].metadata as any).position.x).toBe(800);
    expect((layoutNodes[2].metadata as any).position.y).toBe(100);

    expect(layoutNodes).toHaveLength(3);
  });

  it('should wrap nodes to next row after 3 columns', () => {
    const nodes: Node[] = Array.from({ length: 5 }, (_, i) => ({
      id: `node-${i}`,
      type: 'frontend.react',
      label: `Node ${i}`,
      ports: [],
      artifacts: [],
      metadata: { position: { x: 0, y: 0 } },
    }));

    const layoutNodes = applyLayoutToNodes(nodes);

    expect((layoutNodes[3].metadata as any).position.y).toBe(350);
    expect((layoutNodes[4].metadata as any).position.y).toBe(350);
  });
});

describe('Architecture Generation Integration', () => {
  it('should handle complete todo app generation flow', () => {
    const aiResponse = `\`\`\`json
{
  "understanding": "Simple todo application with React, Express, and PostgreSQL",
  "nodes": [
    {
      "nodeInfo": {
        "type": "frontend.react",
        "label": "React Frontend",
        "description": "User interface for todo management"
      },
      "ports": [
        {
          "name": "API Requests",
          "direction": "out"
        }
      ],
      "artifacts": [
        {
          "path": "src/App.tsx",
          "kind": "source",
          "content": "import React, { useState, useEffect } from 'react';\\nimport axios from 'axios';\\n\\ninterface Todo {\\n  id: number;\\n  title: string;\\n  completed: boolean;\\n}\\n\\nfunction App() {\\n  const [todos, setTodos] = useState<Todo[]>([]);\\n  const [newTodo, setNewTodo] = useState('');\\n\\n  useEffect(() => {\\n    fetchTodos();\\n  }, []);\\n\\n  const fetchTodos = async () => {\\n    const response = await axios.get('http://localhost:3000/api/todos');\\n    setTodos(response.data);\\n  };\\n\\n  const addTodo = async () => {\\n    if (!newTodo.trim()) return;\\n    await axios.post('http://localhost:3000/api/todos', { title: newTodo });\\n    setNewTodo('');\\n    fetchTodos();\\n  };\\n\\n  return (\\n    <div>\\n      <h1>Todo App</h1>\\n      <input value={newTodo} onChange={e => setNewTodo(e.target.value)} />\\n      <button onClick={addTodo}>Add</button>\\n      <ul>\\n        {todos.map(todo => <li key={todo.id}>{todo.title}</li>)}\\n      </ul>\\n    </div>\\n  );\\n}\\n\\nexport default App;"
        }
      ]
    },
    {
      "nodeInfo": {
        "type": "web.rest-api",
        "label": "Express API",
        "description": "REST API for todo operations"
      },
      "ports": [
        {
          "name": "HTTP",
          "direction": "in"
        },
        {
          "name": "DB",
          "direction": "out"
        }
      ],
      "artifacts": [
        {
          "path": "src/index.ts",
          "kind": "source",
          "content": "import express from 'express';\\nimport { Pool } from 'pg';\\n\\nconst app = express();\\nconst db = new Pool({ connectionString: process.env.DATABASE_URL });\\n\\napp.use(express.json());\\n\\napp.get('/api/todos', async (req, res) => {\\n  const result = await db.query('SELECT * FROM todos');\\n  res.json(result.rows);\\n});\\n\\napp.post('/api/todos', async (req, res) => {\\n  const { title } = req.body;\\n  const result = await db.query('INSERT INTO todos (title, completed) VALUES ($1, false) RETURNING *', [title]);\\n  res.json(result.rows[0]);\\n});\\n\\napp.listen(3000, () => console.log('Server running'));"
        }
      ]
    },
    {
      "nodeInfo": {
        "type": "data.postgres",
        "label": "PostgreSQL",
        "description": "Database for storing todos"
      },
      "ports": [
        {
          "name": "Queries",
          "direction": "in"
        }
      ],
      "artifacts": [
        {
          "path": "schema.sql",
          "kind": "schema",
          "content": "CREATE TABLE todos (\\n  id SERIAL PRIMARY KEY,\\n  title TEXT NOT NULL,\\n  completed BOOLEAN DEFAULT FALSE,\\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\\n);"
        }
      ]
    }
  ],
  "edges": [
    {
      "sourceLabel": "React Frontend",
      "targetLabel": "Express API",
      "contractName": "Todo REST API"
    },
    {
      "sourceLabel": "Express API",
      "targetLabel": "PostgreSQL",
      "contractName": "Database Access"
    }
  ],
  "contracts": [
    {
      "name": "Todo REST API",
      "kind": "rest",
      "description": "REST API for CRUD operations on todos",
      "schemaContent": "{\\"openapi\\": \\"3.0.0\\", \\"paths\\": {\\\"/api/todos\\": {\\"get\\": {}, \\"post\\": {}}}}"
    },
    {
      "name": "Database Access",
      "kind": "data_flow",
      "description": "SQL queries to PostgreSQL database"
    }
  ],
  "warnings": ["No authentication implemented"],
  "recommendations": ["Add error handling", "Implement pagination"]
}
\`\`\``;

    const parseResult = parseAIResponse(aiResponse);
    expect(parseResult.success).toBe(true);
    expect(parseResult.data).toBeDefined();

    const architecture = parseResult.data!;

    expect(architecture.nodes).toHaveLength(3);
    expect(architecture.edges).toHaveLength(2);
    expect(architecture.contracts).toHaveLength(2);

    const frontend = architecture.nodes.find(n => n.node.label === 'React Frontend');
    expect(frontend).toBeDefined();
    expect(frontend!.artifacts).toHaveLength(1);
    expect(frontend!.artifacts[0].content).toContain('useState');
    expect(frontend!.artifacts[0].content).toContain('axios');

    const backend = architecture.nodes.find(n => n.node.label === 'Express API');
    expect(backend).toBeDefined();
    expect(backend!.artifacts).toHaveLength(1);
    expect(backend!.artifacts[0].content).toContain('express');
    expect(backend!.artifacts[0].content).toContain('pg');

    const database = architecture.nodes.find(n => n.node.label === 'PostgreSQL');
    expect(database).toBeDefined();
    expect(database!.artifacts).toHaveLength(1);
    expect(database!.artifacts[0].content).toContain('CREATE TABLE');

    const validationResult = validateParsedArchitecture(architecture);
    expect(validationResult.valid).toBe(true);

    expect(architecture.warnings).toContain('No authentication implemented');
    expect(architecture.recommendations).toContain('Add error handling');
  });
});
