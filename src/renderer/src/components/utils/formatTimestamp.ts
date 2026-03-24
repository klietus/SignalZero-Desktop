export const formatTimestamp = (value?: string): string => {
  if (!value) return 'N/A';

  try {
    let millis: number | null = null;

    if (/^\d+$/.test(value)) {
      millis = parseInt(value, 10);
    }

    if (millis === null) {
      try {
        const decoded = atob(value);
        if (/^\d+$/.test(decoded)) {
          millis = parseInt(decoded, 10);
        }
      } catch (err) {
        // Ignore decoding errors and fall back to the raw string
      }
    }

    if (millis === null) {
      const parsed = Date.parse(value);
      if (!isNaN(parsed)) {
        millis = parsed;
      }
    }

    if (millis !== null) {
      const date = new Date(millis);
      if (!isNaN(date.getTime())) {
        return date.toLocaleString();
      }
    }

    return value;
  } catch (err) {
    return value;
  }
};
