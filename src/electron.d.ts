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
      listExternalDocumentNodes: (options: {
        filePath: string;
      }) => Promise<{
        filePath: string;
        fileName: string;
        nodes: { id: string; pageIndex: number; type: string }[];
      } | null>;
      readExternalNodePreview: (options: {
        filePath: string;
        nodeId: string;
      }) => Promise<{
        pageIndex: number;
        nodeId: string;
        type: string;
        title: string;
        content?: import("./model/types").RichTextBlock[];
        assets?: import("./model/types").AssetMap;
        preview: string;
      } | null>;
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
      updateRuntimeState: (state: {
        filePath: string | null;
        viewState: import("./model/types").ViewState;
        activePageIndex: number;
        selectedNodeIds: string[];
      }) => Promise<void>;
      runtimeOpenResult: (result: {
        requestId: string;
        ok: boolean;
        filePath?: string | null;
        error?: string;
      }) => Promise<void>;
      runtimeNavigateResult: (result: {
        requestId: string;
        ok: boolean;
        nodeId?: string;
        error?: string;
      }) => Promise<void>;
      onRuntimeOpenDocument: (callback: (request: {
        requestId: string;
        filePath: string;
      }) => void) => () => void;
      onRuntimeNavigateToNode: (callback: (request: {
        requestId: string;
        nodeId: string;
      }) => void) => () => void;
      searchWorkspace: (options: {
        query: string;
        currentPath?: string;
      }) => Promise<Array<{
        id: string;
        scope: "workspace";
        filePath: string;
        fileName: string;
        pageIndex: number;
        nodeId: string;
        nodeType: string;
        title: string;
        snippet: string;
        matchStart: number;
        matchEnd: number;
      }> | null>;
      listTrashEntries: () => Promise<{ name: string; path: string; size: number; mtimeMs: number }[]>;
      restoreTrashEntry: (options: { filePath: string }) => Promise<{ restoredPath: string; originalName: string }>;
      emptyTrash: () => Promise<void>;
      saveDocumentToTrash: (options: { content: string; baseName: string }) => Promise<string>;
      minimizeWindow: () => Promise<void>;
      toggleMaximizeWindow: () => Promise<boolean>;
      closeWindow: () => Promise<void>;
      dumpPageHtml: () => Promise<string>;
      isWindowAlwaysOnTop: () => Promise<boolean>;
      toggleWindowAlwaysOnTop: () => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
