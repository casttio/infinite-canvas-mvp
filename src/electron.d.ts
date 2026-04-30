export {};

declare global {
  interface WorkspacePageSummary {
    index: number;
    title: string;
  }

  interface WorkspaceDocumentSummary {
    filePath: string;
    fileName: string;
    relativePath: string;
    pageCount: number;
    pages: WorkspacePageSummary[];
    updatedAt?: string;
  }

  interface WorkspaceFileEntry {
    type: "file";
    name: string;
    path: string;
    relativePath: string;
  }

  interface WorkspaceDirectoryEntry {
    type: "directory";
    name: string;
    path: string;
    relativePath: string;
    children: WorkspaceEntry[];
  }

  type WorkspaceEntry = WorkspaceFileEntry | WorkspaceDirectoryEntry;

  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string[]>;
  }

  interface OpenFilePickerOptions {
    multiple?: boolean;
    types?: FilePickerAcceptType[];
  }

  interface SaveFilePickerOptions {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: FileSystemWriteChunkType): Promise<void>;
    close(): Promise<void>;
  }

  interface FileSystemFileHandle {
    getFile(): Promise<File>;
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  type FileSystemWriteChunkType = BufferSource | Blob | string;

  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
    electronApp?: {
      getAutosaveDocument: () => Promise<string | null>;
      saveAutosaveDocument: (content: string) => Promise<void>;
      clearAutosaveDocument: () => Promise<void>;
      openDocumentFromPath: () => Promise<{
        filePath: string;
        fileName: string;
        rawText: string;
        bytes: number[];
      } | null>;
      openDocumentAtPath: (options: {
        filePath: string;
      }) => Promise<{
        filePath: string;
        fileName: string;
        rawText: string;
        bytes: number[];
      } | null>;
      renameDocumentAtPath: (options: {
        filePath: string;
        baseName: string;
      }) => Promise<string>;
      moveDocumentToDirectory: (options: {
        filePath: string;
        targetDirectoryPath: string;
      }) => Promise<string>;
      deleteDocumentAtPath: (options: {
        filePath: string;
      }) => Promise<void>;
      saveDocumentToPath: (options: {
        content: string;
        defaultFileName: string;
        filePath?: string | null;
        forcePrompt?: boolean;
      }) => Promise<string | null>;
      createWorkspaceDirectory: (options: {
        parentDirectoryPath?: string | null;
        name: string;
      }) => Promise<string>;
      renameWorkspaceDirectory: (options: {
        directoryPath: string;
        name: string;
      }) => Promise<string>;
      deleteWorkspaceDirectory: (options: {
        directoryPath: string;
      }) => Promise<void>;
      listWorkspaceEntries: () => Promise<{
        rootPath: string;
        entries: WorkspaceEntry[];
      }>;
      listWorkspaceDocumentSummaries: () => Promise<{
        rootPath: string;
        documents: WorkspaceDocumentSummary[];
      }>;
      pickAndImportAttachment: (options: {
        documentPath: string;
      }) => Promise<{
        name: string;
        mimeType: string;
        relativePath: string;
        sizeBytes: number;
        fileUrl: string;
      } | null>;
      resolveAttachmentUrl: (options: {
        documentPath: string;
        relativePath: string;
      }) => Promise<string | null>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<boolean>;
      closeWindow: () => Promise<void>;
      isWindowAlwaysOnTop: () => Promise<boolean>;
      toggleWindowAlwaysOnTop: () => Promise<boolean>;
    };
  }
}
