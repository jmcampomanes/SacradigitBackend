import { defineFunction, secret } from '@aws-amplify/backend';

export const parishAssistantChat = defineFunction({
  name: 'parishAssistantChat',
  entry: './handler.ts',
  timeoutSeconds: 30,
  environment: {
    // Set with: npx ampx sandbox secret set OPENROUTER_API_KEY
    // (and in the Amplify console -> Secrets for the production branch)
    OPENROUTER_API_KEY: secret('OPENROUTER_API_KEY'),
    // Free OpenRouter model (0 cost per token) — see https://openrouter.ai/models?max_price=0
    OPENROUTER_MODEL: 'google/gemma-4-31b-it:free',
    SITE_NAME: 'SacraDigit',
  },
  // Only calls the public OpenRouter API — no data API access needed.
  resourceGroupName: 'data',
});
