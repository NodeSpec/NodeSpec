import { useState, useEffect } from 'react';
import { CatalogService } from '../services/CatalogService.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';

export function useCatalog(): CatalogResolver | null {
  const [catalog, setCatalog] = useState<CatalogResolver | null>(null);

  useEffect(() => {
    CatalogService.getResolver().then(setCatalog).catch(() => {});
  }, []);

  return catalog;
}
