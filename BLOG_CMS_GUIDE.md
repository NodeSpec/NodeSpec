# Blog CMS Guide

## Overview
The NodeSpec Blog CMS is a content management system built into the admin dashboard that allows you to create, edit, and manage blog posts for SEO purposes.

## Accessing the Blog CMS

1. Navigate to `/admin` (requires admin privileges)
2. Click on the "Blog CMS" tab in the admin dashboard

## Creating a New Blog Post

1. Click the "Create New Post" button
2. Fill in the required fields:
   - **Title**: The main heading of your blog post
   - **Slug**: Auto-generated URL-friendly version (e.g., "my-first-post")
   - **Excerpt**: Short description (shown in blog list and meta tags)
   - **Content**: Full blog post content (supports basic Markdown)
   - **Cover Image URL**: Optional featured image
   - **Categories**: Select one or more categories
   - **Status**: Choose Draft, Published, or Archived

### SEO Settings
- **Meta Title**: Custom title for search engines (defaults to post title)
- **Meta Description**: Custom description for search results (defaults to excerpt)
- **Keywords**: Comma-separated keywords for SEO

3. Click "Create Post" to save

## Markdown Support

The blog content editor supports basic Markdown:
- `# Heading 1` → Large heading
- `## Heading 2` → Medium heading
- `### Heading 3` → Smaller heading
- `- Item` → Bullet point
- Regular text → Paragraph

## Managing Posts

- **Edit**: Click "Edit" button on any post to modify it
- **Delete**: Click "Delete" button (confirmation required)
- **View Count**: Automatically tracked for each post

## Blog Categories

Default categories:
- Engineering
- Architecture
- AI & ML
- Product Updates
- Tutorials

Categories can be managed in the blog_categories table in the database.

## SEO Best Practices

1. **Write Compelling Titles**: Include target keywords naturally
2. **Optimize Excerpts**: 150-160 characters, include keywords
3. **Use Keywords**: Add 3-5 relevant keywords per post
4. **Add Cover Images**: Visual content improves engagement
5. **Publish Regularly**: Consistent posting helps SEO
6. **Internal Linking**: Reference other blog posts in content

## Public Blog Pages

- Blog List: `/blog` - Shows all published posts
- Individual Post: `/blog/[slug]` - Shows specific post with full content

## Sitemap & Robots.txt

The blog is automatically included in:
- `sitemap.xml` - Listed with high priority (0.9) and daily update frequency
- `robots.txt` - Explicitly allowed for all crawlers, especially Googlebot

## URL Structure

All blog URLs follow this pattern:
- `https://nodespec.io/blog` - Main blog page
- `https://nodespec.io/blog/your-post-slug` - Individual posts

Clean URLs without query parameters or unnecessary segments help with SEO.

## Notes

- Only admins can create/edit/delete posts
- Published posts are immediately visible to the public
- Draft posts are only visible to the post author
- View counts increment automatically when users visit posts
- Posts can be archived to hide them without deletion
