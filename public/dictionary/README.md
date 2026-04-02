Place the dictionary JSON files here for runtime loading.

Expected files:
- /public/dictionary/hsk1/hsk1-p1.json
- /public/dictionary/hsk1/hsk1-p2.json
- /public/dictionary/hsk1/hsk1-p3.json
- /public/dictionary/hsk2/hsk2-p1.json
- /public/dictionary/hsk2/hsk2-p2.json
- /public/dictionary/hsk2/hsk2-p3.json

Each JSON file should have this shape:
{
  "words": [
    {
      "word": "帮助",
      "characters": ["帮", "助"],
      "pinyin": "bāng zhù",
      "meaning": "to help"
    }
  ]
}
