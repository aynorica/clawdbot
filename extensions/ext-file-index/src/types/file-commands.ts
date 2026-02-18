export type FileListInput = {
  path: string;
  nodeId?: string;
  recursive?: boolean;
  showHidden?: boolean;
};

export type FileListEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  modified_at?: string;
};

export type FileListOutput = {
  path: string;
  entries: FileListEntry[];
  totalCount: number;
};

export type FileReadInput = {
  path: string;
  nodeId?: string;
  encoding?: "utf8" | "base64";
  maxBytes?: number;
};

export type FileReadOutput = {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
  truncated: boolean;
};

export type FileStatInput = {
  path: string;
  nodeId?: string;
};

export type FileStatOutput = {
  path: string;
  name: string;
  directory: string;
  extension: string;
  size: number;
  type: "file" | "directory" | "symlink";
  created_at: string;
  modified_at: string;
  isReadable: boolean;
  isWritable: boolean;
};

export type FileSearchKeywordInput = {
  path: string;
  keyword: string;
  nodeId?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  filePattern?: string;
};

export type FileSearchKeywordMatch = {
  file: string;
  line: number;
  text: string;
};

export type FileSearchKeywordOutput = {
  path: string;
  keyword: string;
  matches: FileSearchKeywordMatch[];
  totalFiles: number;
};

export type FileCommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };
