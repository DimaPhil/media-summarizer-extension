import type { PromptTemplate } from '../shared/types';

export const DEFAULT_PROMPTS: PromptTemplate[] = [
  {
    id: 'educational',
    name: 'Educational Content',
    prompt: `Summarize this educational video with the following structure:

1. **Main Topic**: What is this video teaching?
2. **Key Concepts**: List 3-5 main concepts explained
3. **Important Details**: Critical facts, formulas, or definitions
4. **Practical Applications**: How can this knowledge be applied?
5. **Summary**: 2-3 sentence overview

Be concise but comprehensive.`,
    isDefault: true,
    mappedCategories: ['27'],
  },
  {
    id: 'tutorial',
    name: 'Tutorial/How-To',
    prompt: `Extract a step-by-step guide from this tutorial video:

1. **Goal**: What will the viewer learn to do?
2. **Prerequisites**: What's needed before starting?
3. **Steps**: Numbered list of actions to take
4. **Tips**: Any pro tips or warnings mentioned
5. **Final Result**: What should be achieved

Format steps clearly for easy following.`,
    isDefault: true,
    mappedCategories: ['26', '28'],
  },
  {
    id: 'podcast',
    name: 'Podcast/Interview',
    prompt: `Summarize this podcast/interview:

1. **Participants**: Who is speaking?
2. **Main Topics**: Key subjects discussed
3. **Notable Quotes**: 2-3 memorable statements
4. **Key Insights**: Main takeaways from the conversation
5. **Conclusion**: How did it wrap up?

Capture the essence of the discussion.`,
    isDefault: true,
    mappedCategories: ['22'],
  },
  {
    id: 'news',
    name: 'News/Current Events',
    prompt: `Analyze this news video:

1. **Headline**: What's the main story?
2. **Key Facts**: Who, what, when, where, why
3. **Sources**: Who provided information?
4. **Context**: Background information mentioned
5. **Impact**: Why does this matter?

Be factual and objective.`,
    isDefault: true,
    mappedCategories: ['25'],
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    prompt: `Summarize this entertainment video:

1. **Content Type**: What kind of video is this?
2. **Main Points**: Key moments or highlights
3. **Notable Elements**: Interesting or memorable aspects
4. **Overall Tone**: What's the vibe?
5. **Quick Take**: 1-2 sentence summary

Keep it fun and engaging.`,
    isDefault: true,
    mappedCategories: ['1', '10', '20', '23', '24'],
  },
  {
    id: 'technical',
    name: 'Technical/Conference Talk',
    prompt: `Summarize this technical presentation:

1. **Topic**: What technology/concept is covered?
2. **Problem Statement**: What problem is being addressed?
3. **Solution/Approach**: How is it being solved?
4. **Key Technical Details**: Important implementation details
5. **Takeaways**: Main lessons for developers/practitioners

Focus on actionable insights.`,
    isDefault: true,
    mappedCategories: ['28'],
  },
  {
    id: 'general',
    name: 'General Summary',
    prompt: `Provide a comprehensive summary of this video:

1. **Overview**: What is this video about?
2. **Key Points**: Main ideas presented (bullet points)
3. **Details**: Important specifics mentioned
4. **Conclusion**: How does it end?

Keep it concise but informative.`,
    isDefault: true,
    mappedCategories: [],
  },
];
