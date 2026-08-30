import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const BRANCH_ID = '00000000-0000-4000-8000-000000000010';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000020';

const TODO_APP_GRAPH = {
  id: PROJECT_ID,
  schemaVersion: 2,
  version: 0,
  hash: '00000000',
  nodes: {
    'aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa': {
      id: 'aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa',
      type: 'frontend.react',
      label: 'React Frontend',
      ports: [
        {
          id: 'port-0001',
          name: 'API Calls',
          direction: 'out' as const,
          required: true,
          contractId: 'contract-rest',
        },
        {
          id: 'port-0002',
          name: 'User Input',
          direction: 'in' as const,
          required: false,
        },
      ],
      artifacts: ['artifact-app', 'artifact-pkg'],
      metadata: {
        framework: 'react',
        position: { x: 100, y: 200 },
        description: 'React application for managing todos',
      },
      status: 'complete' as const,
    },
    'bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb': {
      id: 'bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb',
      type: 'web.rest-api',
      label: 'Node.js API',
      ports: [
        {
          id: 'port-0003',
          name: 'HTTP Endpoints',
          direction: 'in' as const,
          required: true,
          contractId: 'contract-rest',
        },
        {
          id: 'port-0004',
          name: 'Database',
          direction: 'out' as const,
          required: true,
          contractId: 'contract-db',
        },
      ],
      artifacts: ['artifact-server', 'artifact-api-pkg'],
      metadata: {
        framework: 'express',
        position: { x: 500, y: 200 },
        description: 'Express REST API for todo CRUD operations',
      },
      status: 'complete' as const,
    },
    'cccccccc-cccc-4000-8000-cccccccccccc': {
      id: 'cccccccc-cccc-4000-8000-cccccccccccc',
      type: 'database.postgresql',
      label: 'PostgreSQL Database',
      ports: [
        {
          id: 'port-0005',
          name: 'SQL Interface',
          direction: 'in' as const,
          required: true,
          contractId: 'contract-db',
        },
      ],
      artifacts: ['artifact-schema'],
      metadata: {
        dbType: 'postgresql',
        position: { x: 900, y: 200 },
        description: 'PostgreSQL database for storing todos',
      },
      status: 'complete' as const,
    },
  },
  contracts: {
    'contract-rest': {
      id: 'contract-rest',
      kind: 'rest' as const,
      name: 'REST API Contract',
      schema: {
        openapi: '3.0.0',
        paths: {
          '/api/todos': {
            get: { summary: 'List todos' },
            post: { summary: 'Create todo' },
          },
        },
      },
      metadata: {},
      status: 'complete' as const,
    },
    'contract-db': {
      id: 'contract-db',
      kind: 'data_flow' as const,
      name: 'Database Connection',
      schema: {
        type: 'sql',
        dialect: 'postgresql',
      },
      metadata: {},
      status: 'complete' as const,
    },
  },
  edges: {
    'edge-0001': {
      id: 'edge-0001',
      source: 'aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa',
      target: 'bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb',
      sourcePortId: 'port-0001',
      targetPortId: 'port-0003',
      contractId: 'contract-rest',
      label: 'HTTP Requests',
      metadata: {},
    },
    'edge-0002': {
      id: 'edge-0002',
      source: 'bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb',
      target: 'cccccccc-cccc-4000-8000-cccccccccccc',
      sourcePortId: 'port-0004',
      targetPortId: 'port-0005',
      contractId: 'contract-db',
      label: 'SQL Queries',
      metadata: {},
    },
  },
  artifacts: {
    'artifact-app': {
      id: 'artifact-app',
      nodeId: 'aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa',
      kind: 'source' as const,
      path: 'src/App.tsx',
      content: `import React, { useState, useEffect } from 'react';
import './App.css';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    fetch('/api/todos')
      .then(res => res.json())
      .then(data => setTodos(data));
  }, []);

  const addTodo = async () => {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input })
    });
    const todo = await res.json();
    setTodos([...todos, todo]);
    setInput('');
  };

  return (
    <div className="App">
      <h1>Todo List</h1>
      <input value={input} onChange={e => setInput(e.target.value)} />
      <button onClick={addTodo}>Add</button>
      <ul>{todos.map(t => <li key={t.id}>{t.text}</li>)}</ul>
    </div>
  );
}

export default App;`,
      contentHash: 'app001',
      metadata: { language: 'typescript', framework: 'react' },
      status: 'complete' as const,
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    },
    'artifact-pkg': {
      id: 'artifact-pkg',
      nodeId: 'aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa',
      kind: 'config' as const,
      path: 'package.json',
      content: `{
  "name": "todo-frontend",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}`,
      contentHash: 'pkg001',
      metadata: {},
      status: 'complete' as const,
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    },
    'artifact-server': {
      id: 'artifact-server',
      nodeId: 'bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb',
      kind: 'source' as const,
      path: 'src/server.ts',
      content: `import express from 'express';
import { Pool } from 'pg';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

app.get('/api/todos', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM todos ORDER BY id');
  res.json(rows);
});

app.post('/api/todos', async (req, res) => {
  const { text } = req.body;
  const { rows } = await pool.query('INSERT INTO todos (text, completed) VALUES ($1, false) RETURNING *', [text]);
  res.json(rows[0]);
});

app.listen(3000, () => console.log('Server running'));`,
      contentHash: 'srv001',
      metadata: { language: 'typescript', framework: 'express' },
      status: 'complete' as const,
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    },
    'artifact-api-pkg': {
      id: 'artifact-api-pkg',
      nodeId: 'bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb',
      kind: 'config' as const,
      path: 'package.json',
      content: `{
  "name": "todo-api",
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.0"
  }
}`,
      contentHash: 'pkg002',
      metadata: {},
      status: 'complete' as const,
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    },
    'artifact-schema': {
      id: 'artifact-schema',
      nodeId: 'cccccccc-cccc-4000-8000-cccccccccccc',
      kind: 'schema' as const,
      path: 'schema.sql',
      content: `CREATE TABLE IF NOT EXISTS todos (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);`,
      contentHash: 'sch001',
      metadata: { dialect: 'postgresql' },
      status: 'complete' as const,
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    },
  },
  metadata: {},
};

async function createTestProject() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL!;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get the first user from the system
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id')
    .limit(1);

  // Try auth.users if regular users table doesn't exist
  let userId = users && users.length > 0 ? users[0].id : null;

  if (!userId) {
    // Use a known UUID for testing (this will be your actual user ID from auth.users)
    // In production, you should pass this as a parameter
    console.log('Using default user ID for testing');
    userId = '00000000-0000-0000-0000-000000000000'; // Replace with actual user ID
  }

  console.log('Creating project for user:', userId);

  // 1. Create Project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      id: PROJECT_ID,
      name: 'Todo Application',
      owner_id: userId,
      metadata: {
        description: 'Simple todo app with React frontend and Node.js API',
        stack: ['React', 'Express', 'PostgreSQL'],
      },
    })
    .select()
    .single();

  if (projectError) {
    console.error('Project creation error:', projectError);
    return;
  }

  console.log('✅ Project created');

  // 2. Create Main Branch
  const { data: branch, error: branchError } = await supabase
    .from('branches')
    .insert({
      id: BRANCH_ID,
      project_id: PROJECT_ID,
      name: 'main',
      created_by: userId,
      metadata: {},
    })
    .select()
    .single();

  if (branchError) {
    console.error('Branch creation error:', branchError);
    return;
  }

  console.log('✅ Branch created');

  // 3. Create Graph Snapshot
  const { data: snapshot, error: snapshotError } = await supabase
    .from('graph_snapshots')
    .insert({
      id: SNAPSHOT_ID,
      project_id: PROJECT_ID,
      branch_id: BRANCH_ID,
      graph_data: TODO_APP_GRAPH,
      version: 0,
      hash: '00000000',
      patch_sequence: 0,
    })
    .select()
    .single();

  if (snapshotError) {
    console.error('Snapshot creation error:', snapshotError);
    return;
  }

  console.log('✅ Snapshot created');

  // 4. Link Branch to Snapshot
  const { error: updateError } = await supabase
    .from('branches')
    .update({ base_snapshot_id: SNAPSHOT_ID })
    .eq('id', BRANCH_ID);

  if (updateError) {
    console.error('Branch update error:', updateError);
    return;
  }

  console.log('✅ Branch linked to snapshot');
  console.log('\n🎉 Test project created successfully!');
  console.log(`Project ID: ${PROJECT_ID}`);
  console.log(`Branch ID: ${BRANCH_ID}`);
  console.log('\nThe project contains:');
  console.log('- React Frontend (with App.tsx)');
  console.log('- Node.js API (Express server)');
  console.log('- PostgreSQL Database (schema)');
  console.log('\nYou can now test refinement by adding features like Redis caching or authentication!');
}

createTestProject().catch(console.error);
