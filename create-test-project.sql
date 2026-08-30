-- Create a simple Todo App project for testing refinement

-- Variables (replace with actual user ID when executing)
-- User ID will be determined from auth context

-- 1. Create Project
INSERT INTO projects (id, name, owner_id, metadata)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Todo Application',
  (SELECT id FROM auth.users ORDER BY created_at DESC LIMIT 1),
  '{"description": "Simple todo app with React frontend and Node.js API", "stack": ["React", "Express", "PostgreSQL"]}'::jsonb
);

-- 2. Create Main Branch
INSERT INTO branches (id, project_id, name, created_by, metadata)
VALUES (
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001',
  'main',
  (SELECT id FROM auth.users ORDER BY created_at DESC LIMIT 1),
  '{}'::jsonb
);

-- 3. Create Graph Snapshot with Todo App Architecture
INSERT INTO graph_snapshots (id, project_id, branch_id, version, hash, patch_sequence, graph_data)
VALUES (
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000010',
  0,
  '00000000',
  0,
  '{
    "id": "00000000-0000-4000-8000-000000000001",
    "schemaVersion": 2,
    "version": 0,
    "hash": "00000000",
    "nodes": {
      "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa": {
        "id": "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
        "type": "frontend.react",
        "label": "React Frontend",
        "ports": [
          {
            "id": "port-0001",
            "name": "API Calls",
            "direction": "out",
            "required": true,
            "contractId": "contract-rest"
          },
          {
            "id": "port-0002",
            "name": "User Input",
            "direction": "in",
            "required": false
          }
        ],
        "artifacts": ["artifact-app", "artifact-pkg"],
        "metadata": {
          "framework": "react",
          "position": {"x": 100, "y": 200},
          "description": "React application for managing todos"
        },
        "status": "complete"
      },
      "bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb": {
        "id": "bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb",
        "type": "web.rest-api",
        "label": "Node.js API",
        "ports": [
          {
            "id": "port-0003",
            "name": "HTTP Endpoints",
            "direction": "in",
            "required": true,
            "contractId": "contract-rest"
          },
          {
            "id": "port-0004",
            "name": "Database",
            "direction": "out",
            "required": true,
            "contractId": "contract-db"
          }
        ],
        "artifacts": ["artifact-server", "artifact-api-pkg"],
        "metadata": {
          "framework": "express",
          "position": {"x": 500, "y": 200},
          "description": "Express REST API for todo CRUD operations"
        },
        "status": "complete"
      },
      "cccccccc-cccc-4000-8000-cccccccccccc": {
        "id": "cccccccc-cccc-4000-8000-cccccccccccc",
        "type": "database.postgresql",
        "label": "PostgreSQL Database",
        "ports": [
          {
            "id": "port-0005",
            "name": "SQL Interface",
            "direction": "in",
            "required": true,
            "contractId": "contract-db"
          }
        ],
        "artifacts": ["artifact-schema"],
        "metadata": {
          "dbType": "postgresql",
          "position": {"x": 900, "y": 200},
          "description": "PostgreSQL database for storing todos"
        },
        "status": "complete"
      }
    },
    "contracts": {
      "contract-rest": {
        "id": "contract-rest",
        "kind": "rest",
        "name": "REST API Contract",
        "schema": {
          "openapi": "3.0.0",
          "paths": {
            "/api/todos": {
              "get": {"summary": "List todos"},
              "post": {"summary": "Create todo"}
            }
          }
        },
        "metadata": {},
        "status": "complete"
      },
      "contract-db": {
        "id": "contract-db",
        "kind": "data_flow",
        "name": "Database Connection",
        "schema": {
          "type": "sql",
          "dialect": "postgresql"
        },
        "metadata": {},
        "status": "complete"
      }
    },
    "edges": {
      "edge-0001": {
        "id": "edge-0001",
        "source": "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
        "target": "bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb",
        "sourcePortId": "port-0001",
        "targetPortId": "port-0003",
        "contractId": "contract-rest",
        "label": "HTTP Requests",
        "metadata": {}
      },
      "edge-0002": {
        "id": "edge-0002",
        "source": "bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb",
        "target": "cccccccc-cccc-4000-8000-cccccccccccc",
        "sourcePortId": "port-0004",
        "targetPortId": "port-0005",
        "contractId": "contract-db",
        "label": "SQL Queries",
        "metadata": {}
      }
    },
    "artifacts": {
      "artifact-app": {
        "id": "artifact-app",
        "nodeId": "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
        "kind": "source",
        "path": "src/App.tsx",
        "content": "import React, { useState, useEffect } from ''react'';\\nimport ''./App.css'';\\n\\ninterface Todo {\\n  id: number;\\n  text: string;\\n  completed: boolean;\\n}\\n\\nfunction App() {\\n  const [todos, setTodos] = useState<Todo[]>([]);\\n  const [input, setInput] = useState('''');\\n\\n  useEffect(() => {\\n    fetch(''/api/todos'')\\n      .then(res => res.json())\\n      .then(data => setTodos(data));\\n  }, []);\\n\\n  const addTodo = async () => {\\n    const res = await fetch(''/api/todos'', {\\n      method: ''POST'',\\n      headers: { ''Content-Type'': ''application/json'' },\\n      body: JSON.stringify({ text: input })\\n    });\\n    const todo = await res.json();\\n    setTodos([...todos, todo]);\\n    setInput('''');\\n  };\\n\\n  return (\\n    <div className=\\\"App\\\">\\n      <h1>Todo List</h1>\\n      <input value={input} onChange={e => setInput(e.target.value)} />\\n      <button onClick={addTodo}>Add</button>\\n      <ul>{todos.map(t => <li key={t.id}>{t.text}</li>)}</ul>\\n    </div>\\n  );\\n}\\n\\nexport default App;",
        "contentHash": "app001",
        "metadata": {"language": "typescript", "framework": "react"},
        "status": "complete",
        "createdAt": "2026-01-04T00:00:00.000Z",
        "updatedAt": "2026-01-04T00:00:00.000Z"
      },
      "artifact-pkg": {
        "id": "artifact-pkg",
        "nodeId": "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
        "kind": "config",
        "path": "package.json",
        "content": "{\\n  \\"name\\": \\"todo-frontend\\",\\n  \\"dependencies\\": {\\n    \\"react\\": \\"^18.2.0\\",\\n    \\"react-dom\\": \\"^18.2.0\\"\\n  }\\n}",
        "contentHash": "pkg001",
        "metadata": {},
        "status": "complete",
        "createdAt": "2026-01-04T00:00:00.000Z",
        "updatedAt": "2026-01-04T00:00:00.000Z"
      },
      "artifact-server": {
        "id": "artifact-server",
        "nodeId": "bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb",
        "kind": "source",
        "path": "src/server.ts",
        "content": "import express from ''express'';\\nimport { Pool } from ''pg'';\\n\\nconst app = express();\\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\\n\\napp.use(express.json());\\n\\napp.get(''/api/todos'', async (req, res) => {\\n  const { rows } = await pool.query(''SELECT * FROM todos ORDER BY id'');\\n  res.json(rows);\\n});\\n\\napp.post(''/api/todos'', async (req, res) => {\\n  const { text } = req.body;\\n  const { rows } = await pool.query(''INSERT INTO todos (text, completed) VALUES ($1, false) RETURNING *'', [text]);\\n  res.json(rows[0]);\\n});\\n\\napp.listen(3000, () => console.log(''Server running''));",
        "contentHash": "srv001",
        "metadata": {"language": "typescript", "framework": "express"},
        "status": "complete",
        "createdAt": "2026-01-04T00:00:00.000Z",
        "updatedAt": "2026-01-04T00:00:00.000Z"
      },
      "artifact-api-pkg": {
        "id": "artifact-api-pkg",
        "nodeId": "bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb",
        "kind": "config",
        "path": "package.json",
        "content": "{\\n  \\"name\\": \\"todo-api\\",\\n  \\"dependencies\\": {\\n    \\"express\\": \\"^4.18.2\\",\\n    \\"pg\\": \\"^8.11.0\\"\\n  }\\n}",
        "contentHash": "pkg002",
        "metadata": {},
        "status": "complete",
        "createdAt": "2026-01-04T00:00:00.000Z",
        "updatedAt": "2026-01-04T00:00:00.000Z"
      },
      "artifact-schema": {
        "id": "artifact-schema",
        "nodeId": "cccccccc-cccc-4000-8000-cccccccccccc",
        "kind": "schema",
        "path": "schema.sql",
        "content": "CREATE TABLE IF NOT EXISTS todos (\\n  id SERIAL PRIMARY KEY,\\n  text TEXT NOT NULL,\\n  completed BOOLEAN DEFAULT false,\\n  created_at TIMESTAMP DEFAULT NOW()\\n);",
        "contentHash": "sch001",
        "metadata": {"dialect": "postgresql"},
        "status": "complete",
        "createdAt": "2026-01-04T00:00:00.000Z",
        "updatedAt": "2026-01-04T00:00:00.000Z"
      }
    },
    "metadata": {}
  }'::jsonb
);

-- 4. Link branch to snapshot
UPDATE branches
SET base_snapshot_id = '00000000-0000-4000-8000-000000000020'
WHERE id = '00000000-0000-4000-8000-000000000010';
