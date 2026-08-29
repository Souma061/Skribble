//generate mask blanks with revealed letters
export function generateMaskedWord(word, revealedIndices) {
    return word.split("").map((char, index) => {
        if (char === " " || char === "_") {
            return char;
        }
        return revealedIndices.has(index) ? char.toUpperCase() : "_";
    }).join(" ");
}
// "SUNFLOOWER" with revealed indices [0,2] => "S _ N _ _ _ _ _ _ "
//picks a new random unrevealed letter index from the word
export function getNextRevealIndex(word, revealedIndices) {
    const eligibleIndex = [];
    for (let i = 0; i < word.length; i++) {
        if (word[i] !== " " && word[i] !== "_" && !revealedIndices.has(i)) {
            eligibleIndex.push(i);
        }
    }
    if (eligibleIndex.length === 0)
        return null;
    const randomIndex = Math.floor(Math.random() * eligibleIndex.length);
    return eligibleIndex[randomIndex] ?? null;
}
//Levenshtein distance for close-guess
export function getLevenshteinDistance(a, b) {
    const s1 = a.trim().toLowerCase();
    const s2 = b.trim().toLowerCase();
    const matrix = [];
    for (let i = 0; i <= s1.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= s2.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= s1.length; i++) {
        for (let j = 1; j <= s2.length; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return matrix[s1.length][s2.length];
}
//# sourceMappingURL=wordUtils.js.map