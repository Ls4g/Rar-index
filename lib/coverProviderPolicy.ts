export type GoogleBooksBatchGate = {
  apiKey: string | null;
  canRequest: () => boolean;
  skipReason: () => "not_configured" | "rate_limited" | null;
  recordStatus: (status: number) => void;
};

export function createGoogleBooksBatchGate(value: string | null | undefined): GoogleBooksBatchGate {
  const apiKey = value?.trim() || null;
  let rateLimited = false;
  return {
    apiKey,
    canRequest: () => Boolean(apiKey) && !rateLimited,
    skipReason: () => !apiKey ? "not_configured" : rateLimited ? "rate_limited" : null,
    recordStatus: (status) => {
      if (status === 429) rateLimited = true;
    },
  };
}

export function googleBooksRequestUrl(isbn: string, apiKey: string) {
  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: "10",
    projection: "full",
    key: apiKey,
  });
  return `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
}
