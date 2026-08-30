import { getSupabaseClient } from './client.js';
import { migrateGraphToLatest } from '@nodespec/core/migration.js';

// Node IDs
const FRONTEND_NODE_ID = '11111111-1111-4111-8111-111111111111';
const REST_API_NODE_ID = '22222222-2222-4222-8222-222222222222';
const GRAPHQL_API_NODE_ID = '99999999-9999-4999-8999-999999999999';
const POSTGRES_NODE_ID = '33333333-3333-4333-8333-333333333333';
const REDIS_NODE_ID = '55555555-5555-4555-8555-555555555555';
const ELASTICSEARCH_NODE_ID = '66666666-6666-4666-8666-666666666666';
const PAYMENT_NODE_ID = '88888888-8888-4888-8888-888888888888';
const EMAIL_NODE_ID = '44444444-4444-4444-8444-444444444444';

// Port IDs
const PORT_FRONTEND_API = 'f0000001-0001-4001-8001-000000000001';
const PORT_FRONTEND_GRAPHQL = 'f0000002-0002-4002-8002-000000000002';
const PORT_REST_IN = 'f0000004-0004-4004-8004-000000000004';
const PORT_REST_POSTGRES = 'f0000005-0005-4005-8005-000000000005';
const PORT_REST_REDIS = 'f0000006-0006-4006-8006-000000000006';
const PORT_REST_PAYMENT = 'f0000007-0007-4007-8007-000000000007';
const PORT_REST_EMAIL = 'f0000008-0008-4008-8008-000000000008';
const PORT_GRAPHQL_IN = 'f0000009-0009-4009-8009-000000000009';
const PORT_GRAPHQL_POSTGRES = 'f0000010-0010-4010-8010-000000000010';
const PORT_GRAPHQL_ELASTICSEARCH = 'f0000011-0011-4011-8011-000000000011';
const PORT_POSTGRES_IN = 'f0000012-0012-4012-8012-000000000012';
const PORT_REDIS_IN = 'f0000013-0013-4013-8013-000000000013';
const PORT_ELASTICSEARCH_IN = 'f0000014-0014-4014-8014-000000000014';
const PORT_PAYMENT_IN = 'f0000016-0016-4016-8016-000000000016';
const PORT_EMAIL_IN = 'f0000017-0017-4017-8017-000000000017';

// Contract IDs
const CONTRACT_REST_API_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTRACT_GRAPHQL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTRACT_DB_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTRACT_CACHE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CONTRACT_SEARCH_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CONTRACT_PAYMENT_ID = '10101010-1010-4010-8010-101010101010';
const CONTRACT_EMAIL_ID = '11111111-1111-4111-8111-111111111112';

// Edge IDs
const EDGE_FRONTEND_REST = 'e0000001-0001-4001-8001-000000000001';
const EDGE_FRONTEND_GRAPHQL = 'e0000002-0002-4002-8002-000000000002';
const EDGE_REST_POSTGRES = 'e0000004-0004-4004-8004-000000000004';
const EDGE_REST_REDIS = 'e0000005-0005-4005-8005-000000000005';
const EDGE_REST_PAYMENT = 'e0000006-0006-4006-8006-000000000006';
const EDGE_REST_EMAIL = 'e0000007-0007-4007-8007-000000000007';
const EDGE_GRAPHQL_POSTGRES = 'e0000008-0008-4008-8008-000000000008';
const EDGE_GRAPHQL_ELASTICSEARCH = 'e0000009-0009-4009-8009-000000000009';

// Artifact IDs
const ARTIFACT_FRONTEND_PRODUCTS = 'a1111111-1111-4111-8111-111111111111';
const ARTIFACT_FRONTEND_CART = 'a1111112-1111-4111-8111-111111111112';
const ARTIFACT_REST_PRODUCTS = 'a2222222-2222-4222-8222-222222222222';
const ARTIFACT_REST_ORDERS = 'a2222223-2222-4222-8222-222222222223';
const ARTIFACT_GRAPHQL_SCHEMA = 'a3333333-3333-4333-8333-333333333333';
const ARTIFACT_GRAPHQL_RESOLVERS = 'a3333334-3333-4333-8333-333333333334';
const ARTIFACT_DB_SCHEMA = 'a4444444-4444-4444-8444-444444444444';
const ARTIFACT_REST_OPENAPI = 'a5555555-5555-4555-8555-555555555555';

function createSeedGraph(graphId: string): unknown {
  return {
    id: graphId,
    schemaVersion: 2,
    version: 0,
    hash: '00000000',
    nodes: {
      [FRONTEND_NODE_ID]: {
        id: FRONTEND_NODE_ID,
        type: 'frontend.react',
        label: 'React Frontend',
        position: { x: 100, y: 300 },
        ports: [
          {
            id: PORT_FRONTEND_API,
            name: 'REST API',
            direction: 'out',
            required: true,
            contractId: CONTRACT_REST_API_ID,
          },
          {
            id: PORT_FRONTEND_GRAPHQL,
            name: 'GraphQL',
            direction: 'out',
            required: true,
            contractId: CONTRACT_GRAPHQL_ID,
          },
        ],
        artifacts: [ARTIFACT_FRONTEND_PRODUCTS, ARTIFACT_FRONTEND_CART],
        metadata: {
          framework: 'react',
          deploymentType: 'spa',
          buildTool: 'vite',
          description: 'Modern e-commerce storefront with product browsing and shopping cart',
        },
        status: 'complete',
      },
      [REST_API_NODE_ID]: {
        id: REST_API_NODE_ID,
        type: 'web.rest-api',
        label: 'Products REST API',
        position: { x: 500, y: 150 },
        ports: [
          {
            id: PORT_REST_IN,
            name: 'HTTP Endpoints',
            direction: 'in',
            required: true,
            contractId: CONTRACT_REST_API_ID,
            schemaRef: ARTIFACT_REST_OPENAPI,
          },
          {
            id: PORT_REST_POSTGRES,
            name: 'Database',
            direction: 'out',
            required: true,
            contractId: CONTRACT_DB_ID,
          },
          {
            id: PORT_REST_REDIS,
            name: 'Cache',
            direction: 'out',
            required: true,
            contractId: CONTRACT_CACHE_ID,
          },
          {
            id: PORT_REST_PAYMENT,
            name: 'Payment Gateway',
            direction: 'out',
            required: true,
            contractId: CONTRACT_PAYMENT_ID,
          },
          {
            id: PORT_REST_EMAIL,
            name: 'Email Service',
            direction: 'out',
            required: false,
            contractId: CONTRACT_EMAIL_ID,
          },
        ],
        artifacts: [ARTIFACT_REST_PRODUCTS, ARTIFACT_REST_ORDERS, ARTIFACT_REST_OPENAPI],
        metadata: {
          framework: 'express',
          deploymentType: 'containerized',
          runtime: 'node',
          baseUrl: '/api/v1',
          description: 'RESTful API for product management and order processing',
        },
        status: 'complete',
      },
      [GRAPHQL_API_NODE_ID]: {
        id: GRAPHQL_API_NODE_ID,
        type: 'web.graphql-api',
        label: 'Search & Catalog GraphQL',
        position: { x: 500, y: 450 },
        ports: [
          {
            id: PORT_GRAPHQL_IN,
            name: 'GraphQL Endpoint',
            direction: 'in',
            required: true,
            contractId: CONTRACT_GRAPHQL_ID,
            schemaRef: ARTIFACT_GRAPHQL_SCHEMA,
          },
          {
            id: PORT_GRAPHQL_POSTGRES,
            name: 'Database',
            direction: 'out',
            required: true,
            contractId: CONTRACT_DB_ID,
          },
          {
            id: PORT_GRAPHQL_ELASTICSEARCH,
            name: 'Search Engine',
            direction: 'out',
            required: true,
            contractId: CONTRACT_SEARCH_ID,
          },
        ],
        artifacts: [ARTIFACT_GRAPHQL_SCHEMA, ARTIFACT_GRAPHQL_RESOLVERS],
        metadata: {
          framework: 'apollo-server',
          deploymentType: 'serverless',
          description: 'GraphQL API for product search and catalog browsing',
        },
        status: 'complete',
      },
      [POSTGRES_NODE_ID]: {
        id: POSTGRES_NODE_ID,
        type: 'database.postgresql',
        label: 'Primary Database',
        position: { x: 900, y: 300 },
        ports: [
          {
            id: PORT_POSTGRES_IN,
            name: 'SQL Interface',
            direction: 'in',
            required: true,
            contractId: CONTRACT_DB_ID,
            schemaRef: ARTIFACT_DB_SCHEMA,
          },
        ],
        artifacts: [ARTIFACT_DB_SCHEMA],
        metadata: {
          dbType: 'postgresql',
          host: 'db.example.com',
          port: 5432,
          database: 'ecommerce',
          ssl: true,
          version: '15',
          description: 'Primary relational database for products, orders, and users',
        },
        status: 'complete',
      },
      [REDIS_NODE_ID]: {
        id: REDIS_NODE_ID,
        type: 'database.redis',
        label: 'Session & Cache',
        position: { x: 900, y: 100 },
        ports: [
          {
            id: PORT_REDIS_IN,
            name: 'Redis Commands',
            direction: 'in',
            required: true,
            contractId: CONTRACT_CACHE_ID,
          },
        ],
        artifacts: [],
        metadata: {
          dbType: 'redis',
          host: 'cache.example.com',
          port: 6379,
          mode: 'cluster',
          evictionPolicy: 'allkeys-lru',
          description: 'Redis cluster for session storage and caching',
        },
        status: 'complete',
      },
      [ELASTICSEARCH_NODE_ID]: {
        id: ELASTICSEARCH_NODE_ID,
        type: 'database.elasticsearch',
        label: 'Product Search',
        position: { x: 900, y: 500 },
        ports: [
          {
            id: PORT_ELASTICSEARCH_IN,
            name: 'Search API',
            direction: 'in',
            required: true,
            contractId: CONTRACT_SEARCH_ID,
          },
        ],
        artifacts: [],
        metadata: {
          dbType: 'elasticsearch',
          host: 'search.example.com',
          port: 9200,
          protocol: 'https',
          index: 'products',
          shards: 5,
          replicas: 2,
          description: 'Elasticsearch cluster for full-text product search',
        },
        status: 'complete',
      },
      [PAYMENT_NODE_ID]: {
        id: PAYMENT_NODE_ID,
        type: 'external.service',
        label: 'Stripe Payments',
        position: { x: 900, y: 700 },
        ports: [
          {
            id: PORT_PAYMENT_IN,
            name: 'Payment API',
            direction: 'in',
            required: true,
            contractId: CONTRACT_PAYMENT_ID,
          },
        ],
        artifacts: [],
        metadata: {
          provider: 'stripe',
          apiVersion: '2023-10-16',
          description: 'Stripe payment processing for orders',
        },
        status: 'complete',
      },
      [EMAIL_NODE_ID]: {
        id: EMAIL_NODE_ID,
        type: 'external.service',
        label: 'SendGrid Email',
        position: { x: 500, y: 700 },
        ports: [
          {
            id: PORT_EMAIL_IN,
            name: 'Email API',
            direction: 'in',
            required: true,
            contractId: CONTRACT_EMAIL_ID,
          },
        ],
        artifacts: [],
        metadata: {
          provider: 'sendgrid',
          description: 'Transactional emails for order confirmations',
        },
        status: 'complete',
      },
    },
    contracts: {
      [CONTRACT_REST_API_ID]: {
        id: CONTRACT_REST_API_ID,
        kind: 'rest',
        name: 'Products REST API Contract',
        schema: {
          openapi: '3.0.0',
          info: { title: 'Products API', version: '1.0.0' },
          paths: {
            '/products': {
              get: { summary: 'List products' },
              post: { summary: 'Create product' },
            },
            '/products/{id}': {
              get: { summary: 'Get product' },
              put: { summary: 'Update product' },
            },
            '/orders': {
              post: { summary: 'Create order' },
            },
          },
        },
        metadata: {},
        status: 'complete',
      },
      [CONTRACT_GRAPHQL_ID]: {
        id: CONTRACT_GRAPHQL_ID,
        kind: 'graphql',
        name: 'Product Catalog GraphQL',
        schema: {
          types: ['Product', 'Category', 'SearchResult'],
          queries: ['products', 'product', 'searchProducts', 'categories'],
          mutations: [],
        },
        metadata: {},
        status: 'complete',
      },
      [CONTRACT_DB_ID]: {
        id: CONTRACT_DB_ID,
        kind: 'sql',
        name: 'PostgreSQL Connection',
        schema: {
          type: 'sql',
          dialect: 'postgresql',
          operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        },
        metadata: {},
        status: 'complete',
      },
      [CONTRACT_CACHE_ID]: {
        id: CONTRACT_CACHE_ID,
        kind: 'sql',
        name: 'Redis Cache',
        schema: {
          type: 'key-value',
          operations: ['GET', 'SET', 'DEL', 'EXPIRE'],
        },
        metadata: {},
        status: 'complete',
      },
      [CONTRACT_SEARCH_ID]: {
        id: CONTRACT_SEARCH_ID,
        kind: 'rest',
        name: 'Elasticsearch Search',
        schema: {
          type: 'search',
          operations: ['search', 'index', 'update'],
        },
        metadata: {},
        status: 'complete',
      },
      [CONTRACT_PAYMENT_ID]: {
        id: CONTRACT_PAYMENT_ID,
        kind: 'rest',
        name: 'Stripe Payment API',
        schema: {
          openapi: '3.0.0',
          paths: {
            '/payment-intents': {
              post: { summary: 'Create payment intent' },
            },
          },
        },
        metadata: {},
        status: 'complete',
      },
      [CONTRACT_EMAIL_ID]: {
        id: CONTRACT_EMAIL_ID,
        kind: 'rest',
        name: 'SendGrid Email API',
        schema: {
          openapi: '3.0.0',
          paths: {
            '/mail/send': {
              post: { summary: 'Send email' },
            },
          },
        },
        metadata: {},
        status: 'complete',
      },
    },
    edges: {
      [EDGE_FRONTEND_REST]: {
        id: EDGE_FRONTEND_REST,
        source: FRONTEND_NODE_ID,
        target: REST_API_NODE_ID,
        sourcePortId: PORT_FRONTEND_API,
        targetPortId: PORT_REST_IN,
        contractId: CONTRACT_REST_API_ID,
        label: 'HTTPS REST',
        metadata: {},
      },
      [EDGE_FRONTEND_GRAPHQL]: {
        id: EDGE_FRONTEND_GRAPHQL,
        source: FRONTEND_NODE_ID,
        target: GRAPHQL_API_NODE_ID,
        sourcePortId: PORT_FRONTEND_GRAPHQL,
        targetPortId: PORT_GRAPHQL_IN,
        contractId: CONTRACT_GRAPHQL_ID,
        label: 'GraphQL Queries',
        metadata: {},
      },
      [EDGE_REST_POSTGRES]: {
        id: EDGE_REST_POSTGRES,
        source: REST_API_NODE_ID,
        target: POSTGRES_NODE_ID,
        sourcePortId: PORT_REST_POSTGRES,
        targetPortId: PORT_POSTGRES_IN,
        contractId: CONTRACT_DB_ID,
        label: 'SQL Queries',
        metadata: {},
      },
      [EDGE_REST_REDIS]: {
        id: EDGE_REST_REDIS,
        source: REST_API_NODE_ID,
        target: REDIS_NODE_ID,
        sourcePortId: PORT_REST_REDIS,
        targetPortId: PORT_REDIS_IN,
        contractId: CONTRACT_CACHE_ID,
        label: 'Cache Operations',
        metadata: {},
      },
      [EDGE_REST_PAYMENT]: {
        id: EDGE_REST_PAYMENT,
        source: REST_API_NODE_ID,
        target: PAYMENT_NODE_ID,
        sourcePortId: PORT_REST_PAYMENT,
        targetPortId: PORT_PAYMENT_IN,
        contractId: CONTRACT_PAYMENT_ID,
        label: 'Process Payments',
        metadata: {},
      },
      [EDGE_REST_EMAIL]: {
        id: EDGE_REST_EMAIL,
        source: REST_API_NODE_ID,
        target: EMAIL_NODE_ID,
        sourcePortId: PORT_REST_EMAIL,
        targetPortId: PORT_EMAIL_IN,
        contractId: CONTRACT_EMAIL_ID,
        label: 'Order Confirmations',
        metadata: {},
      },
      [EDGE_GRAPHQL_POSTGRES]: {
        id: EDGE_GRAPHQL_POSTGRES,
        source: GRAPHQL_API_NODE_ID,
        target: POSTGRES_NODE_ID,
        sourcePortId: PORT_GRAPHQL_POSTGRES,
        targetPortId: PORT_POSTGRES_IN,
        contractId: CONTRACT_DB_ID,
        label: 'SQL Queries',
        metadata: {},
      },
      [EDGE_GRAPHQL_ELASTICSEARCH]: {
        id: EDGE_GRAPHQL_ELASTICSEARCH,
        source: GRAPHQL_API_NODE_ID,
        target: ELASTICSEARCH_NODE_ID,
        sourcePortId: PORT_GRAPHQL_ELASTICSEARCH,
        targetPortId: PORT_ELASTICSEARCH_IN,
        contractId: CONTRACT_SEARCH_ID,
        label: 'Product Search',
        metadata: {},
      },
    },
    artifacts: {
      [ARTIFACT_FRONTEND_PRODUCTS]: {
        id: ARTIFACT_FRONTEND_PRODUCTS,
        nodeId: FRONTEND_NODE_ID,
        kind: 'source',
        path: 'src/components/ProductGrid.tsx',
        content: `import { useState } from 'react';
import { useQuery, gql } from '@apollo/client';

const GET_PRODUCTS = gql\`
  query GetProducts($category: String, $limit: Int) {
    products(category: $category, limit: $limit) {
      id name description price imageUrl inStock
    }
  }
\`;

interface Product {
  id: string; name: string; description: string;
  price: number; imageUrl: string; inStock: boolean;
}

export function ProductGrid() {
  const [category, setCategory] = useState<string | null>(null);
  const { loading, error, data } = useQuery(GET_PRODUCTS, {
    variables: { category, limit: 20 },
  });

  const addToCart = async (productId: string) => {
    await fetch('/api/v1/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity: 1 }),
    });
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error loading products</div>;

  return (
    <div className="product-grid">
      <div className="filters">
        <button onClick={() => setCategory(null)}>All</button>
        <button onClick={() => setCategory('electronics')}>Electronics</button>
      </div>
      <div className="grid">
        {data.products.map((product: Product) => (
          <div key={product.id} className="product-card">
            <img src={product.imageUrl} alt={product.name} />
            <h3>{product.name}</h3>
            <p>{product.description}</p>
            <div>\${product.price.toFixed(2)}</div>
            <button onClick={() => addToCart(product.id)} disabled={!product.inStock}>
              {product.inStock ? 'Add to Cart' : 'Out of Stock'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}`,
        contentHash: 'prod12345',
        metadata: { language: 'typescript', framework: 'react' },
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [ARTIFACT_FRONTEND_CART]: {
        id: ARTIFACT_FRONTEND_CART,
        nodeId: FRONTEND_NODE_ID,
        kind: 'source',
        path: 'src/components/ShoppingCart.tsx',
        content: `import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.VITE_STRIPE_PUBLIC_KEY!);

interface CartItem {
  id: string; productId: string; productName: string;
  quantity: number; price: number;
}

export function ShoppingCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchCart(); }, []);

  const fetchCart = async () => {
    const res = await fetch('/api/v1/cart');
    const data = await res.json();
    setItems(data.items);
  };

  const updateQuantity = async (itemId: string, quantity: number) => {
    await fetch(\`/api/v1/cart/items/\${itemId}\`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    });
    fetchCart();
  };

  const checkout = async () => {
    setLoading(true);
    const res = await fetch('/api/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const { clientSecret } = await res.json();
    const stripe = await stripePromise;
    if (!stripe) return;
    const { error } = await stripe.confirmCardPayment(clientSecret);
    if (error) alert('Payment failed');
    else { alert('Order placed!'); setItems([]); }
    setLoading(false);
  };

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="cart">
      <h2>Shopping Cart</h2>
      {items.length === 0 ? <p>Empty</p> : (
        <>
          {items.map(item => (
            <div key={item.id}>
              <span>{item.productName}</span>
              <input type="number" value={item.quantity} min="1"
                onChange={(e) => updateQuantity(item.id, parseInt(e.target.value))} />
              <span>\${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div>
            <strong>Total: \${total.toFixed(2)}</strong>
            <button onClick={checkout} disabled={loading}>
              {loading ? 'Processing...' : 'Checkout'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}`,
        contentHash: 'cart67890',
        metadata: { language: 'typescript', framework: 'react' },
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [ARTIFACT_REST_PRODUCTS]: {
        id: ARTIFACT_REST_PRODUCTS,
        nodeId: REST_API_NODE_ID,
        kind: 'source',
        path: 'src/routes/products.ts',
        content: `import express from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';

const router = express.Router();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });

router.get('/products', async (req, res) => {
  const { category, limit = 20 } = req.query;
  const cacheKey = \`products:\${category || 'all'}:\${limit}\`;
  const cached = await redis.get(cacheKey);
  if (cached) return res.json(JSON.parse(cached));

  let query = 'SELECT * FROM products WHERE 1=1';
  const params: any[] = [];
  if (category) { params.push(category); query += \` AND category = $\${params.length}\`; }
  params.push(limit); query += \` ORDER BY created_at DESC LIMIT $\${params.length}\`;

  const result = await db.query(query, params);
  await redis.setEx(cacheKey, 300, JSON.stringify(result.rows));
  res.json(result.rows);
});

router.get('/products/:id', async (req, res) => {
  const { id } = req.params;
  const result = await db.query('SELECT * FROM products WHERE id = $1', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

router.post('/products', async (req, res) => {
  const { name, description, price, category, image_url, stock } = req.body;
  const result = await db.query(
    \`INSERT INTO products (name, description, price, category, image_url, stock)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *\`,
    [name, description, price, category, image_url, stock]
  );
  res.status(201).json(result.rows[0]);
});

export default router;`,
        contentHash: 'prod22222',
        metadata: { language: 'typescript', framework: 'express' },
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [ARTIFACT_REST_ORDERS]: {
        id: ARTIFACT_REST_ORDERS,
        nodeId: REST_API_NODE_ID,
        kind: 'source',
        path: 'src/routes/orders.ts',
        content: `import express from 'express';
import { Pool } from 'pg';
import Stripe from 'stripe';

const router = express.Router();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

router.post('/orders', async (req, res) => {
  const { items } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let totalAmount = 0;
    for (const item of items) {
      const result = await client.query('SELECT price, stock FROM products WHERE id = $1', [item.productId]);
      if (result.rows.length === 0) throw new Error(\`Product not found\`);
      const product = result.rows[0];
      if (product.stock < item.quantity) throw new Error(\`Insufficient stock\`);
      totalAmount += product.price * item.quantity;
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.productId]);
    }
    const orderResult = await client.query(
      \`INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, 'pending') RETURNING id\`,
      [req.user?.id || 'guest', totalAmount]
    );
    const orderId = orderResult.rows[0].id;
    for (const item of items) {
      await client.query(
        \`INSERT INTO order_items (order_id, product_id, quantity, price)
         SELECT $1, $2, $3, price FROM products WHERE id = $2\`,
        [orderId, item.productId, item.quantity]
      );
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalAmount * 100),
      currency: 'usd',
      metadata: { orderId },
    });
    await client.query('COMMIT');
    res.json({ orderId, clientSecret: paymentIntent.client_secret });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: (error as Error).message });
  } finally {
    client.release();
  }
});

export default router;`,
        contentHash: 'orders333',
        metadata: { language: 'typescript', framework: 'express' },
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [ARTIFACT_GRAPHQL_SCHEMA]: {
        id: ARTIFACT_GRAPHQL_SCHEMA,
        nodeId: GRAPHQL_API_NODE_ID,
        kind: 'schema',
        path: 'src/graphql/schema.graphql',
        content: `type Product {
  id: ID!
  name: String!
  description: String
  price: Float!
  category: String!
  imageUrl: String
  inStock: Boolean!
  stock: Int!
}

type Query {
  products(category: String, limit: Int): [Product!]!
  product(id: ID!): Product
  searchProducts(query: String!, category: String, page: Int): [Product!]!
}`,
        contentHash: 'gql444',
        metadata: { format: 'graphql' },
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [ARTIFACT_GRAPHQL_RESOLVERS]: {
        id: ARTIFACT_GRAPHQL_RESOLVERS,
        nodeId: GRAPHQL_API_NODE_ID,
        kind: 'source',
        path: 'src/graphql/resolvers.ts',
        content: `import { Pool } from 'pg';
import { Client } from '@elastic/elasticsearch';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const es = new Client({ node: process.env.ELASTICSEARCH_URL });

export const resolvers = {
  Query: {
    products: async (_: any, { category, limit = 20 }: any) => {
      let query = 'SELECT * FROM products WHERE 1=1';
      const params: any[] = [];
      if (category) { params.push(category); query += \` AND category = $\${params.length}\`; }
      params.push(limit); query += \` ORDER BY created_at DESC LIMIT $\${params.length}\`;
      const result = await db.query(query, params);
      return result.rows;
    },
    product: async (_: any, { id }: any) => {
      const result = await db.query('SELECT * FROM products WHERE id = $1', [id]);
      return result.rows[0] || null;
    },
    searchProducts: async (_: any, { query, category, page = 1 }: any) => {
      const must: any[] = [{ multi_match: { query, fields: ['name^2', 'description'], fuzziness: 'AUTO' } }];
      if (category) must.push({ term: { category } });
      const result = await es.search({
        index: 'products',
        from: (page - 1) * 20,
        size: 20,
        body: { query: { bool: { must } } },
      });
      return result.hits.hits.map((hit: any) => ({ id: hit._id, ...hit._source }));
    },
  },
  Product: {
    inStock: (product: any) => product.stock > 0,
  },
};`,
        contentHash: 'resolv555',
        metadata: { language: 'typescript', framework: 'graphql' },
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [ARTIFACT_DB_SCHEMA]: {
        id: ARTIFACT_DB_SCHEMA,
        nodeId: POSTGRES_NODE_ID,
        kind: 'schema',
        path: 'db/schema.sql',
        content: `CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
  category VARCHAR(100) NOT NULL,
  image_url TEXT,
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_price ON products(price);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL CHECK (total_amount >= 0),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INT NOT NULL CHECK (quantity > 0),
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO products (name, description, price, category, stock) VALUES
  ('Wireless Mouse', 'Ergonomic wireless mouse', 29.99, 'electronics', 150),
  ('Mechanical Keyboard', 'RGB gaming keyboard', 89.99, 'electronics', 75),
  ('Cotton T-Shirt', 'Premium cotton tee', 19.99, 'clothing', 200);`,
        contentHash: 'dbsch666',
        metadata: { dialect: 'postgresql' },
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [ARTIFACT_REST_OPENAPI]: {
        id: ARTIFACT_REST_OPENAPI,
        nodeId: REST_API_NODE_ID,
        kind: 'schema',
        path: 'api/openapi.yaml',
        content: `openapi: 3.0.0
info:
  title: E-Commerce Products API
  version: 1.0.0
paths:
  /products:
    get:
      summary: List products
      parameters:
        - name: category
          in: query
          schema:
            type: string
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Product'
    post:
      summary: Create product
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ProductInput'
      responses:
        '201':
          description: Created
  /orders:
    post:
      summary: Create order
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/OrderInput'
      responses:
        '201':
          description: Order created
components:
  schemas:
    Product:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        price:
          type: number
        category:
          type: string
        stock:
          type: integer
    ProductInput:
      type: object
      required:
        - name
        - price
        - category
      properties:
        name:
          type: string
        description:
          type: string
        price:
          type: number
        category:
          type: string
        stock:
          type: integer
    OrderInput:
      type: object
      properties:
        items:
          type: array
          items:
            type: object
            properties:
              productId:
                type: string
              quantity:
                type: integer`,
        contentHash: 'openapi777',
        metadata: { format: 'yaml' },
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    metadata: {},
  };
}

export async function createDummyDataForUser(userId: string): Promise<{ projectId: string; branchId: string }> {
  const supabase = getSupabaseClient();

  console.log('Creating project for user:', userId);

  const { data: project, error: projectError} = await supabase
    .from('projects')
    .insert({
      name: 'Todo Application',
      owner_id: userId,
      metadata: {
        description: 'Simple todo app with React frontend and Node.js API - for testing refinement',
        stack: ['React', 'Express', 'PostgreSQL'],
      },
    })
    .select()
    .single();

  if (projectError || !project) {
    console.error('Project creation error:', projectError);
    throw new Error(`Failed to create project: ${projectError?.message || 'Unknown error'}`);
  }

  console.log('Project created:', project.id);

  console.log('Creating main branch...');

  const { data: branch, error: branchError } = await supabase
    .from('branches')
    .insert({
      project_id: project.id,
      name: 'main',
      base_snapshot_id: null,
      created_by: userId,
      metadata: {},
    })
    .select()
    .single();

  if (branchError || !branch) {
    console.error('Branch creation error:', branchError);
    throw new Error(`Failed to create branch: ${branchError?.message || 'Unknown error'}`);
  }

  console.log('Branch created:', branch.id);

  const migratedGraph = migrateGraphToLatest(createSeedGraph(project.id));

  console.log('Creating initial snapshot...');

  const { data: snapshot, error: snapshotError } = await supabase
    .from('graph_snapshots')
    .insert({
      project_id: project.id,
      branch_id: branch.id,
      graph_data: migratedGraph,
      version: 0,
      hash: '00000000',
      patch_sequence: 0,
    })
    .select()
    .single();

  if (snapshotError || !snapshot) {
    console.error('Snapshot creation error:', snapshotError);
    throw new Error(`Failed to create snapshot: ${snapshotError?.message || 'Unknown error'}`);
  }

  console.log('Snapshot created:', snapshot.id);

  const { error: updateError } = await supabase
    .from('branches')
    .update({ base_snapshot_id: snapshot.id })
    .eq('id', branch.id);

  if (updateError) {
    console.error('Branch update error:', updateError);
    throw new Error(`Failed to link snapshot to branch: ${updateError.message}`);
  }

  console.log('Branch linked to snapshot');

  return { projectId: project.id, branchId: branch.id };
}

export async function checkUserHasProjects(userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('owner_id', userId)
    .limit(1);

  if (error) {
    console.error('Error checking user projects:', error);
    return false;
  }

  return (data?.length || 0) > 0;
}
