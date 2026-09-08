export declare function generateMaskedWord(word: string, revealedIndices: Set<number>): string;
export declare function getNextRevealIndex(word: string, revealedIndices: Set<number>): number | null;
export declare function normalizeWord(value: string): string;
export declare function isExactWordMatch(value: string, secret: string): boolean;
export declare function doesMessageRevealWord(message: string, secret: string): boolean;
export declare function findAllowedWord(suggestions: string[], selectedWord: string): string | undefined;
export declare function validateCustomWord(value: string): string | undefined;
export declare function getLevenshteinDistance(a: string, b: string): number;
//# sourceMappingURL=wordUtils.d.ts.map