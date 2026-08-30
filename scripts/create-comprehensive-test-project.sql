-- Comprehensive Test Project with Full Architecture
-- Run this with: supabase db push or via the Supabase dashboard SQL editor

DO $$
DECLARE
  test_user_id UUID := 'c0000000-0000-0000-0000-000000000001';
  test_project_id UUID;
  test_branch_id UUID;
  test_spec_id UUID;
  test_section_functional_id UUID;
  test_section_nonfunctional_id UUID;
  test_feature1_id UUID;
  test_feature2_id UUID;
  test_feature3_id UUID;
  test_req1_id UUID;
  test_req2_id UUID;
  test_req3_id UUID;
  node_frontend_id UUID;
  node_backend_id UUID;
  node_database_id UUID;
  node_cache_id UUID;
  node_queue_id UUID;
BEGIN
  -- Generate IDs
  test_project_id := gen_random_uuid();
  test_branch_id := gen_random_uuid();
  test_spec_id := gen_random_uuid();
  test_section_functional_id := gen_random_uuid();
  test_section_nonfunctional_id := gen_random_uuid();
  test_feature1_id := gen_random_uuid();
  test_feature2_id := gen_random_uuid();
  test_feature3_id := gen_random_uuid();
  test_req1_id := gen_random_uuid();
  test_req2_id := gen_random_uuid();
  test_req3_id := gen_random_uuid();
  node_frontend_id := gen_random_uuid();
  node_backend_id := gen_random_uuid();
  node_database_id := gen_random_uuid();
  node_cache_id := gen_random_uuid();
  node_queue_id := gen_random_uuid();

  -- 1. Create test project
  INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
  VALUES (
    test_project_id,
    'E-Commerce Platform Test',
    'Complete test project with architecture and mappings',
    test_user_id,
    NOW(),
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- 2. Create main branch
  INSERT INTO branches (id, name, project_id, head_snapshot_id, created_at)
  VALUES (
    test_branch_id,
    'main',
    test_project_id,
    NULL,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- 3. Create specification
  INSERT INTO project_specifications (
    id, project_id, title, overview, status, version, created_by, created_at, updated_at, confirmed
  ) VALUES (
    test_spec_id,
    test_project_id,
    'E-Commerce Platform Specification',
    'A comprehensive e-commerce platform with user management, product catalog, and order processing',
    'approved',
    '1.0',
    test_user_id,
    NOW(),
    NOW(),
    true
  ) ON CONFLICT (id) DO NOTHING;

  -- 4. Create sections
  INSERT INTO specification_sections (id, specification_id, section_type, title, content, order_index, created_at)
  VALUES
    (test_section_functional_id, test_spec_id, 'functional', 'Functional Requirements',
     E'- User registration and authentication\n- Product browsing and search\n- Shopping cart management\n- Order processing and tracking\n- Payment integration',
     0, NOW()),
    (test_section_nonfunctional_id, test_spec_id, 'non_functional', 'Non-Functional Requirements',
     E'- System should handle 10,000 concurrent users\n- Response time under 200ms\n- 99.9% uptime\n- GDPR compliance',
     1, NOW())
  ON CONFLICT (id) DO NOTHING;

  -- 5. Create features
  INSERT INTO features (id, specification_id, feature_id, name, description, priority, technical_components, created_at)
  VALUES
    (test_feature1_id, test_spec_id, 'FEA-001', 'User Management System',
     'Complete user registration, authentication, and profile management',
     'high',
     '[{"type": "frontend.react", "name": "User UI"}, {"type": "web.rest-api", "name": "Auth API"}]'::jsonb,
     NOW()),
    (test_feature2_id, test_spec_id, 'FEA-002', 'Product Catalog',
     'Product browsing, search, filtering, and detailed product views',
     'high',
     '[{"type": "frontend.react", "name": "Product UI"}, {"type": "database.postgresql", "name": "Product DB"}]'::jsonb,
     NOW()),
    (test_feature3_id, test_spec_id, 'FEA-003', 'Order Processing',
     'Shopping cart, checkout, payment processing, and order tracking',
     'high',
     '[{"type": "web.rest-api", "name": "Order API"}, {"type": "queue.rabbitmq", "name": "Order Queue"}]'::jsonb,
     NOW())
  ON CONFLICT (id) DO NOTHING;

  -- 6. Create requirements
  INSERT INTO requirements (id, specification_id, requirement_id, name, description, section_id, priority, feature_names, confirmed, created_at)
  VALUES
    (test_req1_id, test_spec_id, 'REQ-F001', 'User Registration',
     'Users must be able to register with email and password', test_section_functional_id,
     'high', ARRAY['User Management System'], true, NOW()),
    (test_req2_id, test_spec_id, 'REQ-F002', 'Product Search',
     'Users must be able to search and filter products', test_section_functional_id,
     'high', ARRAY['Product Catalog'], true, NOW()),
    (test_req3_id, test_spec_id, 'REQ-F003', 'Checkout Process',
     'Users must be able to complete checkout and payment', test_section_functional_id,
     'high', ARRAY['Order Processing'], true, NOW())
  ON CONFLICT (id) DO NOTHING;

  -- 7. Create graph snapshot with architecture nodes
  INSERT INTO graph_snapshots (id, branch_id, graph_data, sequence, metadata, created_at)
  VALUES (
    gen_random_uuid(),
    test_branch_id,
    jsonb_build_object(
      'nodes', jsonb_build_object(
        node_frontend_id, jsonb_build_object(
          'id', node_frontend_id,
          'type', 'frontend.react',
          'label', 'React Frontend',
          'ports', '[]'::jsonb,
          'artifacts', '[]'::jsonb,
          'metadata', jsonb_build_object(
            'description', 'Main user interface built with React',
            'position', jsonb_build_object('x', 100, 'y', 100),
            'language', 'typescript',
            'framework', 'react'
          )
        ),
        node_backend_id, jsonb_build_object(
          'id', node_backend_id,
          'type', 'web.rest-api',
          'label', 'REST API Server',
          'ports', '[]'::jsonb,
          'artifacts', '[]'::jsonb,
          'metadata', jsonb_build_object(
            'description', 'Backend API handling business logic',
            'position', jsonb_build_object('x', 100, 'y', 300),
            'language', 'typescript',
            'framework', 'express'
          )
        ),
        node_database_id, jsonb_build_object(
          'id', node_database_id,
          'type', 'database.postgresql',
          'label', 'PostgreSQL Database',
          'ports', '[]'::jsonb,
          'artifacts', '[]'::jsonb,
          'metadata', jsonb_build_object(
            'description', 'Primary data store',
            'position', jsonb_build_object('x', 100, 'y', 500),
            'version', '15'
          )
        ),
        node_cache_id, jsonb_build_object(
          'id', node_cache_id,
          'type', 'cache.redis',
          'label', 'Redis Cache',
          'ports', '[]'::jsonb,
          'artifacts', '[]'::jsonb,
          'metadata', jsonb_build_object(
            'description', 'Caching layer for performance',
            'position', jsonb_build_object('x', 450, 'y', 300),
            'framework', 'redis'
          )
        ),
        node_queue_id, jsonb_build_object(
          'id', node_queue_id,
          'type', 'queue.rabbitmq',
          'label', 'RabbitMQ Queue',
          'ports', '[]'::jsonb,
          'artifacts', '[]'::jsonb,
          'metadata', jsonb_build_object(
            'description', 'Message queue for async processing',
            'position', jsonb_build_object('x', 450, 'y', 500)
          )
        )
      ),
      'edges', '{}'::jsonb,
      'contracts', '{}'::jsonb
    ),
    1,
    '{}'::jsonb,
    NOW()
  ) ON CONFLICT DO NOTHING;

  -- 8. Update branch with snapshot
  UPDATE branches
  SET head_snapshot_id = (
    SELECT id FROM graph_snapshots WHERE branch_id = test_branch_id ORDER BY created_at DESC LIMIT 1
  )
  WHERE id = test_branch_id;

  -- 9. Create feature-to-node mappings
  INSERT INTO specification_mappings (
    id, specification_id, requirement_id, node_id, mapping_type, confidence, notes, feature_names, created_at
  ) VALUES
    -- User Management -> Frontend + Backend
    (gen_random_uuid(), test_spec_id, test_req1_id, node_frontend_id, 'implements', 0.9,
     'React frontend provides user registration UI', ARRAY['User Management System'], NOW()),
    (gen_random_uuid(), test_spec_id, test_req1_id, node_backend_id, 'implements', 0.95,
     'REST API handles authentication logic', ARRAY['User Management System'], NOW()),

    -- Product Catalog -> Frontend + Backend + Database
    (gen_random_uuid(), test_spec_id, test_req2_id, node_frontend_id, 'implements', 0.9,
     'React frontend displays products', ARRAY['Product Catalog'], NOW()),
    (gen_random_uuid(), test_spec_id, test_req2_id, node_backend_id, 'implements', 0.85,
     'API provides product endpoints', ARRAY['Product Catalog'], NOW()),
    (gen_random_uuid(), test_spec_id, test_req2_id, node_database_id, 'implements', 0.95,
     'Database stores product data', ARRAY['Product Catalog'], NOW()),
    (gen_random_uuid(), test_spec_id, test_req2_id, node_cache_id, 'implements', 0.8,
     'Redis caches product search results', ARRAY['Product Catalog'], NOW()),

    -- Order Processing -> Backend + Queue + Database
    (gen_random_uuid(), test_spec_id, test_req3_id, node_backend_id, 'implements', 0.9,
     'API handles order creation', ARRAY['Order Processing'], NOW()),
    (gen_random_uuid(), test_spec_id, test_req3_id, node_queue_id, 'implements', 0.95,
     'Queue processes orders asynchronously', ARRAY['Order Processing'], NOW()),
    (gen_random_uuid(), test_spec_id, test_req3_id, node_database_id, 'implements', 0.9,
     'Database stores order data', ARRAY['Order Processing'], NOW())
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Test project created successfully!';
  RAISE NOTICE 'Project ID: %', test_project_id;
  RAISE NOTICE 'Specification ID: %', test_spec_id;
  RAISE NOTICE 'Branch ID: %', test_branch_id;
  RAISE NOTICE 'Features: 3, Requirements: 3, Nodes: 5, Mappings: 9';
END $$;
