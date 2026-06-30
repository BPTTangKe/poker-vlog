import { defineCollection, z } from 'astro:content';

const vlogCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.date(),
    excerpt: z.string(),
    tags: z.array(z.string()).default([]),
    image: z.string().optional(),
    seo_description: z.string().optional(),
  }),
});

export const collections = {
  vlog: vlogCollection,
};
