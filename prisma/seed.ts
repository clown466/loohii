import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const stylePresets = [
    {
      slug: "cinematic-anime",
      name: "Cinematic Anime",
      description: "High-contrast anime frames with film lighting and clean line work.",
      prompt:
        "cinematic anime style, expressive character acting, clean line art, detailed background, dramatic lighting",
      negativePrompt:
        "low quality, distorted anatomy, unreadable face, muddy colors, watermark",
      settings: {
        palette: "vivid",
        lighting: "cinematic",
        lineWeight: "medium",
      },
    },
    {
      slug: "storybook-watercolor",
      name: "Storybook Watercolor",
      description: "Soft illustrated scenes for warm character-driven stories.",
      prompt:
        "storybook watercolor illustration, soft edges, warm light, handcrafted texture, charming character design",
      negativePrompt:
        "photorealistic, harsh shadows, oversaturated, noisy texture, watermark",
      settings: {
        palette: "pastel",
        texture: "paper",
        lighting: "soft",
      },
    },
    {
      slug: "noir-comic",
      name: "Noir Comic",
      description: "Graphic black-and-white comic styling with sharp silhouettes.",
      prompt:
        "noir comic panel, bold ink shadows, dramatic silhouettes, high contrast, cinematic composition",
      negativePrompt:
        "flat lighting, washed out contrast, cluttered frame, low detail, watermark",
      settings: {
        palette: "monochrome",
        contrast: "high",
        lineWeight: "heavy",
      },
    },
  ];

  for (const preset of stylePresets) {
    await prisma.stylePreset.upsert({
      where: { slug: preset.slug },
      update: {
        name: preset.name,
        description: preset.description,
        prompt: preset.prompt,
        negativePrompt: preset.negativePrompt,
        settings: preset.settings,
        isSystem: true,
        isActive: true,
      },
      create: {
        ...preset,
        isSystem: true,
        isActive: true,
      },
    });
  }

  // AI models are intentionally not seeded. They require a real provider config
  // and encrypted API key, so users should add them from Settings > Model Config.
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
