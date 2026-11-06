/**
 * OPML 2.0 Engine & Outliner for Post Card Spatial OS
 * Derived from OPML spec & opml.org validator reference implementation.
 */

export type OpmlOutlineNode = {
  text: string;
  type?: string;
  isComment?: boolean;
  isBreakpoint?: boolean;
  created?: string;
  category?: string;
  attributes?: Record<string, string>;
  subs?: OpmlOutlineNode[];
};

export type OpmlDocument = {
  title: string;
  dateCreated?: string;
  dateModified?: string;
  ownerName?: string;
  ownerEmail?: string;
  outlines: OpmlOutlineNode[];
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderNodeToXml(node: OpmlOutlineNode, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  const textAttr = `text="${escapeXml(node.text)}"`;
  const typeAttr = node.type ? ` type="${escapeXml(node.type)}"` : "";
  const createdAttr = node.created ? ` created="${escapeXml(node.created)}"` : "";
  const categoryAttr = node.category ? ` category="${escapeXml(node.category)}"` : "";
  
  let extraAttrs = "";
  if (node.attributes) {
    for (const [k, v] of Object.entries(node.attributes)) {
      if (k !== "text" && k !== "type" && k !== "created" && k !== "category") {
        extraAttrs += ` ${k}="${escapeXml(v)}"`;
      }
    }
  }

  if (!node.subs || node.subs.length === 0) {
    return `${indent}<outline ${textAttr}${typeAttr}${createdAttr}${categoryAttr}${extraAttrs} />\n`;
  }

  let xml = `${indent}<outline ${textAttr}${typeAttr}${createdAttr}${categoryAttr}${extraAttrs}>\n`;
  for (const child of node.subs) {
    xml += renderNodeToXml(child, indentLevel + 1);
  }
  xml += `${indent}</outline>\n`;
  return xml;
}

/**
 * Serializes an OpmlDocument to an OPML 2.0 compliant XML string.
 */
export function stringifyOpml(doc: OpmlDocument): string {
  const now = new Date().toUTCString();
  const created = doc.dateCreated || now;
  const modified = doc.dateModified || now;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<opml version="2.0">\n`;
  xml += `  <head>\n`;
  xml += `    <title>${escapeXml(doc.title)}</title>\n`;
  xml += `    <dateCreated>${created}</dateCreated>\n`;
  xml += `    <dateModified>${modified}</dateModified>\n`;
  if (doc.ownerName) xml += `    <ownerName>${escapeXml(doc.ownerName)}</ownerName>\n`;
  if (doc.ownerEmail) xml += `    <ownerEmail>${escapeXml(doc.ownerEmail)}</ownerEmail>\n`;
  xml += `    <generator>Post Card Spatial OS - The One AI Butler</generator>\n`;
  xml += `  </head>\n`;
  xml += `  <body>\n`;

  for (const rootNode of doc.outlines) {
    xml += renderNodeToXml(rootNode, 2);
  }

  xml += `  </body>\n`;
  xml += `</opml>\n`;
  return xml;
}

/**
 * Validates an OPML XML string and reports conformance.
 */
export function validateOpmlString(xmlString: string): { valid: boolean; title?: string; outlineCount: number; errors: string[] } {
  const errors: string[] = [];
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      return { valid: false, outlineCount: 0, errors: [parserError.textContent || "XML parse error"] };
    }

    const opmlElem = xmlDoc.querySelector("opml");
    if (!opmlElem) {
      errors.push("Missing root <opml> element.");
    } else {
      const version = opmlElem.getAttribute("version");
      if (!version) errors.push("Warning: <opml> element is missing version attribute.");
    }

    const head = xmlDoc.querySelector("opml > head");
    if (!head) errors.push("Missing <head> section.");

    const body = xmlDoc.querySelector("opml > body");
    if (!body) errors.push("Missing <body> section.");

    const title = head?.querySelector("title")?.textContent || "Untitled Outline";
    const outlines = xmlDoc.querySelectorAll("outline");

    return {
      valid: errors.length === 0,
      title,
      outlineCount: outlines.length,
      errors,
    };
  } catch (err: unknown) {
    return {
      valid: false,
      outlineCount: 0,
      errors: [(err as Error)?.message || "Unknown error parsing OPML"],
    };
  }
}
