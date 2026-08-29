import { PrismaClient, WordDifficulty } from "@prisma/client";

const prisma = new PrismaClient();

const STARTER_WORDS: { word: string; category: string; difficulty: WordDifficulty }[] = [
  // Easy
  { word: "apple", category: "food", difficulty: "EASY" },
  { word: "banana", category: "food", difficulty: "EASY" },
  { word: "cat", category: "animals", difficulty: "EASY" },
  { word: "dog", category: "animals", difficulty: "EASY" },
  { word: "sun", category: "nature", difficulty: "EASY" },
  { word: "tree", category: "nature", difficulty: "EASY" },
  { word: "car", category: "vehicles", difficulty: "EASY" },
  { word: "house", category: "objects", difficulty: "EASY" },
  { word: "book", category: "objects", difficulty: "EASY" },
  { word: "star", category: "nature", difficulty: "EASY" },
  { word: "fish", category: "animals", difficulty: "EASY" },
  { word: "ball", category: "sports", difficulty: "EASY" },
  { word: "hat", category: "clothing", difficulty: "EASY" },
  { word: "cup", category: "objects", difficulty: "EASY" },
  { word: "clock", category: "objects", difficulty: "EASY" },

  // Medium
  { word: "guitar", category: "music", difficulty: "MEDIUM" },
  { word: "castle", category: "places", difficulty: "MEDIUM" },
  { word: "rocket", category: "space", difficulty: "MEDIUM" },
  { word: "camera", category: "electronics", difficulty: "MEDIUM" },
  { word: "dragon", category: "fantasy", difficulty: "MEDIUM" },
  { word: "bridge", category: "places", difficulty: "MEDIUM" },
  { word: "island", category: "nature", difficulty: "MEDIUM" },
  { word: "spider", category: "animals", difficulty: "MEDIUM" },
  { word: "bicycle", category: "vehicles", difficulty: "MEDIUM" },
  { word: "volcano", category: "nature", difficulty: "MEDIUM" },
  { word: "telescope", category: "science", difficulty: "MEDIUM" },
  { word: "pizza", category: "food", difficulty: "MEDIUM" },
  { word: "butterfly", category: "animals", difficulty: "MEDIUM" },
  { word: "snowman", category: "winter", difficulty: "MEDIUM" },
  { word: "submarine", category: "vehicles", difficulty: "MEDIUM" },

  // Hard
  { word: "constellation", category: "space", difficulty: "HARD" },
  { word: "microscope", category: "science", difficulty: "HARD" },
  { word: "skyscraper", category: "architecture", difficulty: "HARD" },
  { word: "labyrinth", category: "places", difficulty: "HARD" },
  { word: "photosynthesis", category: "science", difficulty: "HARD" },
  { word: "chameleon", category: "animals", difficulty: "HARD" },
  { word: "archaeologist", category: "professions", difficulty: "HARD" },
  { word: "kaleidoscope", category: "objects", difficulty: "HARD" },
  { word: "waterfall", category: "nature", difficulty: "HARD" },
  { word: "lighthouse", category: "places", difficulty: "HARD" },
];

async function main() {
  console.log("Seeding Skribble words dictionary...");
  for (const item of STARTER_WORDS) {
    await prisma.word.upsert({
      where: { word: item.word },
      update: {},
      create: item,
    });
  }
  console.log(`Seeded ${STARTER_WORDS.length} starter words successfully.`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
