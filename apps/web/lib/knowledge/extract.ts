/**
 * Pull plain text out of an uploaded training document (#94). The Train step
 * used to read every file with `File.text()`, which UTF-8-decodes a PDF into
 * mojibake and embeds it — a silent failure. Binary formats are parsed here
 * instead, and anything we can't parse is rejected loudly.
 */

/** Uploads above this are rejected before parsing (Vercel body limits, and a
 *  document this large is a sign something is wrong). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** The format itself can't be read — the caller answers 415. */
export class UnsupportedFileError extends Error {}

/** A readable format, just too big — the caller answers 413, not 415. */
export class FileTooLargeError extends Error {}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isDocx(file: File): boolean {
  return (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  );
}

function isPlainText(file: File): boolean {
  return file.type.startsWith("text/") || /\.(txt|md|markdown)$/i.test(file.name);
}

/**
 * Extract text from an uploaded file. Throws `UnsupportedFileError` for formats
 * we can't read, so the caller can answer 415 rather than store garbage.
 * Parsers are imported lazily — the paste path shouldn't pay for them.
 */
export async function extractText(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new FileTooLargeError("File is larger than 10MB.");
  }

  if (isPdf(file)) {
    const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  }

  if (isDocx(file)) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return value;
  }

  if (isPlainText(file)) return file.text();

  // .doc, .pages, images, spreadsheets — better to say so than to embed noise.
  throw new UnsupportedFileError(
    `Cannot read ${file.name || "that file"}. Supported formats: PDF, Word (.docx), .txt, .md.`,
  );
}
