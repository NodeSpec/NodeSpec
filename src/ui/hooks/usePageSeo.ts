import { useEffect } from 'react';

const SITE_NAME = 'NodeSpec';
const BASE_URL = 'https://nodespec.io';
const DEFAULT_IMAGE = `${BASE_URL}/og-card.png`;

export { SITE_NAME, BASE_URL, DEFAULT_IMAGE };

export function setMeta(name: string, content: string, property = false) {
  const attr = property ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function setCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function setJsonLd(id: string, data: object) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.setAttribute('type', 'application/ld+json');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export function removeJsonLd(id: string) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface PageSeoProps {
  title: string;
  description: string;
  path: string;
  keywords?: string;
  ogType?: string;
  image?: string;
  noIndex?: boolean;
  breadcrumbs?: BreadcrumbItem[];
  jsonLd?: { id: string; data: object }[];
}

export function usePageSeo(props: PageSeoProps) {
  useEffect(() => {
    const {
      title,
      description,
      path,
      keywords,
      ogType = 'website',
      image = DEFAULT_IMAGE,
      noIndex = false,
      breadcrumbs,
      jsonLd,
    } = props;

    const canonicalUrl = `${BASE_URL}${path}`;

    document.title = title;

    setMeta('description', description);
    if (keywords) {
      setMeta('keywords', keywords);
    }
    setMeta('robots', noIndex ? 'noindex, nofollow' : 'index, follow');

    setCanonical(canonicalUrl);

    setMeta('og:type', ogType, true);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:url', canonicalUrl, true);
    setMeta('og:image', image, true);
    setMeta('og:image:width', '1200', true);
    setMeta('og:image:height', '630', true);
    setMeta('og:site_name', SITE_NAME, true);
    setMeta('og:locale', 'en_US', true);

    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);
    setMeta('twitter:image', image);
    setMeta('twitter:site', '@nodespec');

    const jsonLdIds: string[] = [];

    if (breadcrumbs && breadcrumbs.length > 0) {
      const bcId = 'page-breadcrumb-schema';
      jsonLdIds.push(bcId);
      setJsonLd(bcId, {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumbs.map((item, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: item.name,
          item: item.url,
        })),
      });
    }

    if (jsonLd) {
      for (const entry of jsonLd) {
        jsonLdIds.push(entry.id);
        setJsonLd(entry.id, entry.data);
      }
    }

    return () => {
      for (const id of jsonLdIds) {
        removeJsonLd(id);
      }
    };
  }, [props.title, props.description, props.path, props.keywords, props.ogType, props.image, props.noIndex]);
}
