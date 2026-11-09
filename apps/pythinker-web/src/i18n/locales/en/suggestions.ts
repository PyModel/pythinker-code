export default {
  explainRepository: {
    title: 'Explain this repository',
    description: 'See the main packages and how they work together.',
    prompt: 'Explain this repository. Show the main packages and how they work together.',
  },
  suggestFirstTask: {
    title: 'Find a good first task',
    description: 'Inspect the code and suggest a small useful task.',
    prompt: 'Inspect this repository and suggest a small, useful first task.',
  },
  runChecks: {
    title: 'Run the project checks',
    description: 'Run the relevant tests and report any failures.',
    prompt: 'Run the relevant project checks and report any failures.',
  },
  reviewWorkingTree: {
    title: 'Review the working tree',
    description: 'Find bugs, risks, or missing tests in current changes.',
    prompt: 'Review the current working tree for bugs, risks, and missing tests.',
  },
} as const;
