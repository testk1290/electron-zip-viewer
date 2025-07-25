import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

async function dataUrlToBlobUrl(dataUrl) {
  if (!dataUrl) return null;
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error("Failed to convert Data URL to Blob URL:", e);
    return null;
  }
}

const ImageViewer = ({ imageUrls, onExit }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const viewerRef = useRef(null);

  useEffect(() => {
    return () => {
      imageUrls.forEach(url => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [imageUrls]);

  const goToPrevious = useCallback(() => {
    if (imageUrls.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + imageUrls.length) % imageUrls.length);
  }, [imageUrls.length]);

  const goToNext = useCallback(() => {
    if (imageUrls.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % imageUrls.length);
  }, [imageUrls.length]);

  const toggleFullscreen = () => {
    if (!viewerRef.current) return;
    if (!document.fullscreenElement) {
      viewerRef.current.requestFullscreen().catch(err => alert(`全画面表示エラー: ${err.message}`));
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') goToPrevious();
      else if (e.key === 'ArrowRight') goToNext();
      else if (e.key === 'f') toggleFullscreen();
      else if (e.key === 'Escape') {
        if (document.fullscreenElement) document.exitFullscreen();
        onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevious, goToNext, onExit]);

  return (
    <div className="viewer-container" ref={viewerRef}>
      {imageUrls.length > 0 ? (
        <>
          <div className="image-wrapper"><img src={imageUrls[currentIndex]} alt={`Page ${currentIndex + 1}`} /></div>
          <div className="controls"><button onClick={goToPrevious} className="nav-button">＜</button><span className="page-info">{currentIndex + 1} / {imageUrls.length}</span><button onClick={goToNext} className="nav-button">＞</button></div>
          <div className="toolbar"><button onClick={toggleFullscreen} className="fullscreen-button">全画面表示 (f)</button><button onClick={onExit} className="exit-button">一覧に戻る</button></div>
        </>
      ) : (
        <div><p>画像の読み込みに失敗しました、または画像が含まれていません。</p><button onClick={onExit} className="exit-button">一覧に戻る</button></div>
      )}
    </div>
  );
};


function App() {
  const [targetFolder, setTargetFolder] = useState('');
  const [previews, setPreviews] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('フォルダを選択してください');
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [viewerImageUrls, setViewerImageUrls] = useState([]);
  const [isLoadingViewer, setIsLoadingViewer] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const cancelScanRef = useRef(false);

  useEffect(() => {
    const loadInitialData = async () => {
      if (window.electronAPI) {
        const savedFolder = await window.electronAPI.getStoreValue('targetFolder');
        const savedPreviews = await window.electronAPI.getStoreValue('previews');
        if (savedFolder) {
          setTargetFolder(savedFolder);
          setStatusMessage(`対象フォルダ: ${savedFolder}`);
        }
        if (savedPreviews) {
          setPreviews(savedPreviews);
        }
      } else {
        setStatusMessage("エラー: アプリケーションの初期化に失敗しました。");
      }
    };
    loadInitialData();
  }, []);

  const handleSelectFolder = async () => {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
      setTargetFolder(folderPath);
      await window.electronAPI.setStoreValue('targetFolder', folderPath);
      scanAndGeneratePreviews(folderPath);
    }
  };
  
  const scanAndGeneratePreviews = async (folderPath) => {
    if (!folderPath) return;

    cancelScanRef.current = false;
    setIsScanning(true);
    setPreviews([]);
    setProgress({ processed: 0, total: 0 });
    setStatusMessage('ファイルリストを取得中...');

    const filePaths = await window.electronAPI.scanFolder(folderPath);
    if (!filePaths || filePaths.length === 0) {
      setStatusMessage('対象フォルダにZIPファイルが見つかりませんでした。');
      setIsScanning(false);
      return;
    }
    
    setProgress({ processed: 0, total: filePaths.length });

    let processedCount = 0;
    const newPreviewsList = [];

    for (const path of filePaths) {
      if (cancelScanRef.current) {
        setStatusMessage(`スキャンがキャンセルされました (${processedCount}/${filePaths.length})`);
        break;
      }

      const thumbnail = await window.electronAPI.generateThumbnail(path);
      const newPreview = { path, name: path.split(/[/\\]/).pop(), thumbnail };

      newPreviewsList.push(newPreview);
      setPreviews([...newPreviewsList]);

      processedCount++;
      setProgress(prev => ({ ...prev, processed: processedCount }));
    }

    await window.electronAPI.setStoreValue('previews', newPreviewsList);
    
    if (!cancelScanRef.current) {
      setStatusMessage(`${processedCount}個のZIPファイルを読み込みました。`);
    }
    
    setIsScanning(false);
  };

  const handleCancelScan = () => {
    cancelScanRef.current = true;
  };

  const openViewer = async (filePath) => {
    setIsLoadingViewer(true);
    setIsViewerOpen(true);
    const dataUrls = await window.electronAPI.getAllImages(filePath);
    if (dataUrls && dataUrls.length > 0) {
      const blobUrls = await Promise.all(dataUrls.map(dataUrlToBlobUrl));
      setViewerImageUrls(blobUrls.filter(url => url !== null));
    } else {
      setViewerImageUrls([]);
    }
    setIsLoadingViewer(false);
  };

  const closeViewer = () => {
    setIsViewerOpen(false);
    viewerImageUrls.forEach(url => { if (url) URL.revokeObjectURL(url); });
    setViewerImageUrls([]);
  };

  if (isViewerOpen) {
    if (isLoadingViewer) {
      return <div className="loading-fullscreen"><p>ビューアを準備中...</p></div>;
    }
    return <ImageViewer imageUrls={viewerImageUrls} onExit={closeViewer} />;
  }
  
  return (
    <div className="App">
      <header className="App-header"><h1>Electron ZIP Viewer</h1></header>
      <main className="container">
        <div className="folder-area">
          <p className="folder-path" title={targetFolder}>対象フォルダ: {targetFolder || '未選択'}</p>
          <div className="folder-actions">
            <button onClick={handleSelectFolder} disabled={isScanning}>フォルダを選択</button>
            {targetFolder && (<button onClick={() => scanAndGeneratePreviews(targetFolder)} disabled={isScanning}>フォルダを再スキャン</button>)}
            {isScanning && (<button onClick={handleCancelScan} className="cancel-button">キャンセル</button>)}
          </div>
          {isScanning && (
            <div className="progress-area">
              <p>{statusMessage}</p>
              <progress value={progress.processed} max={progress.total}></progress>
              <span>{progress.processed} / {progress.total}</span>
            </div>
          )}
        </div>
        <div className="preview-list">
          {previews.map(p => (
            <div key={p.path} className="preview-item"><div className="preview-thumbnail">{p.thumbnail ? <img src={p.thumbnail} alt={p.name} /> : <div className="no-image">?</div>}</div><p className="filename" title={p.path}>{p.name}</p><button onClick={() => openViewer(p.path)} className="view-button" disabled={!p.thumbnail}>開く</button></div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;