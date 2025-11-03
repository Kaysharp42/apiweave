import React, { useState, useCallback } from 'react';
import { MdAdd, MdDelete, MdImage } from 'react-icons/md';

const FileUploadSection = ({ fileUploads = [], onUpdate, variables = {} }) => {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'base64',
    value: '',
    fieldName: 'file',
    mimeType: 'application/octet-stream',
    description: ''
  });
  const [previewImage, setPreviewImage] = useState(null);

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target.result;
      setFormData(prev => ({
        ...prev,
        type: 'base64',
        value: base64String,
        mimeType: file.type || 'application/octet-stream',
        name: file.name.replace(/\.[^/.]+$/, '') // Remove extension for name
      }));

      // Preview for images
      if (file.type.startsWith('image/')) {
        setPreviewImage(base64String);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAddFile = () => {
    if (!formData.name.trim() || !formData.value.trim() || !formData.fieldName.trim()) {
      alert('Please fill in name, value, and field name');
      return;
    }

    const newFile = {
      name: formData.name,
      type: formData.type,
      value: formData.value,
      fieldName: formData.fieldName,
      mimeType: formData.mimeType,
      description: formData.description
    };

    onUpdate([...fileUploads, newFile]);
    setFormData({
      name: '',
      type: 'base64',
      value: '',
      fieldName: 'file',
      mimeType: 'application/octet-stream',
      description: ''
    });
    setPreviewImage(null);
    setShowForm(false);
  };

  const handleRemoveFile = (index) => {
    onUpdate(fileUploads.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t dark:border-gray-700 pt-2 mt-2">
      <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5 flex items-center gap-1">
        📎 File Attachments
        <span className="text-gray-500 dark:text-gray-500 font-normal text-[9px]">
          ({fileUploads.length})
        </span>
      </label>

      {/* File List */}
      <div className="space-y-1 mb-2">
        {fileUploads.length > 0 ? (
          fileUploads.map((file, idx) => (
            <div key={idx} className="flex gap-1 items-center text-[9px] p-1 bg-gray-50 dark:bg-gray-900/30 rounded">
              <div className="flex-1">
                <div className="font-semibold text-gray-700 dark:text-gray-300">{file.name}</div>
                <div className="text-[8px] text-gray-500 dark:text-gray-400">
                  Type: <span className="font-mono">{file.type}</span> | Field: <span className="font-mono">{file.fieldName}</span>
                </div>
                {file.description && (
                  <div className="text-[8px] text-gray-600 dark:text-gray-400 italic">{file.description}</div>
                )}
                {file.type === 'base64' && file.value.startsWith('data:image') && (
                  <div className="mt-0.5 text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <MdImage className="w-3 h-3" />
                    Image preview available
                  </div>
                )}
              </div>
              <button
                className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 nodrag flex-shrink-0"
                onClick={() => handleRemoveFile(idx)}
                title="Delete file"
              >
                <MdDelete className="w-3 h-3" />
              </button>
            </div>
          ))
        ) : (
          <div className="text-[9px] text-gray-500 dark:text-gray-400 italic">No files attached</div>
        )}
      </div>

      {/* Add File Form */}
      {!showForm ? (
        <button
          className="w-full px-2 py-1 bg-blue-500 dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-700 text-white text-[9px] font-semibold rounded nodrag transition-colors flex items-center justify-center gap-1"
          onClick={() => setShowForm(true)}
        >
          <MdAdd className="w-3 h-3" />
          <span>Add File</span>
        </button>
      ) : (
        <div className="space-y-1 p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded border border-dashed border-blue-300 dark:border-blue-600">
          {/* File Name */}
          <div>
            <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
              File Name (identifier)
            </label>
            <input
              type="text"
              placeholder="e.g., resume, invoice"
              className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>

          {/* Reference Type */}
          <div>
            <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
              Reference Type
            </label>
            <select
              className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.type}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, type: e.target.value, value: '' }));
                setPreviewImage(null);
              }}
            >
              <option value="base64">Base64 Encoded (Embedded)</option>
              <option value="path">File Path (Read from disk)</option>
              <option value="variable">Variable Reference</option>
            </select>
          </div>

          {/* File Input/Value based on type */}
          <div>
            <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
              {formData.type === 'base64' && 'Upload File or Paste Base64'}
              {formData.type === 'path' && 'File Path'}
              {formData.type === 'variable' && 'Variable Reference'}
            </label>
            {formData.type === 'base64' ? (
              <div className="space-y-1">
                <input
                  type="file"
                  onChange={handleFileSelect}
                  className="nodrag w-full text-[9px] border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title="Select a file to upload"
                />
                <textarea
                  placeholder="Or paste base64 content here..."
                  className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  value={formData.value}
                  onChange={(e) => setFormData(prev => ({ ...prev, value: e.target.value }))}
                />
              </div>
            ) : formData.type === 'path' ? (
              <textarea
                placeholder={`e.g., /uploads/document.pdf\nor {{env.UPLOAD_DIR}}/{{variables.filename}}`}
                className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                value={formData.value}
                onChange={(e) => setFormData(prev => ({ ...prev, value: e.target.value }))}
              />
            ) : (
              <textarea
                placeholder={`e.g., {{variables.filePath}}\nor {{variables.fileContent}}`}
                className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                value={formData.value}
                onChange={(e) => setFormData(prev => ({ ...prev, value: e.target.value }))}
              />
            )}
          </div>

          {/* Field Name */}
          <div>
            <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
              HTML Field Name
            </label>
            <input
              type="text"
              placeholder="e.g., document, image, attachment"
              className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.fieldName}
              onChange={(e) => setFormData(prev => ({ ...prev, fieldName: e.target.value }))}
            />
          </div>

          {/* MIME Type */}
          <div>
            <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
              MIME Type
            </label>
            <input
              type="text"
              placeholder="e.g., application/pdf, image/png"
              className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.mimeType}
              onChange={(e) => setFormData(prev => ({ ...prev, mimeType: e.target.value }))}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
              Description (optional)
            </label>
            <input
              type="text"
              placeholder="e.g., User resume document"
              className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            />
          </div>

          {/* Image Preview */}
          {previewImage && (
            <div className="text-center">
              <img
                src={previewImage}
                alt="Preview"
                className="max-w-full max-h-20 rounded border border-gray-300 dark:border-gray-600 mx-auto"
              />
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-1">
            <button
              onClick={handleAddFile}
              className="flex-1 px-2 py-1 bg-green-500 dark:bg-green-600 hover:bg-green-600 dark:hover:bg-green-700 text-white text-[9px] font-semibold rounded nodrag transition-colors"
            >
              Add File
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setFormData({
                  name: '',
                  type: 'base64',
                  value: '',
                  fieldName: 'file',
                  mimeType: 'application/octet-stream',
                  description: ''
                });
                setPreviewImage(null);
              }}
              className="flex-1 px-2 py-1 bg-gray-500 dark:bg-gray-600 hover:bg-gray-600 dark:hover:bg-gray-700 text-white text-[9px] font-semibold rounded nodrag transition-colors"
            >
              Cancel
            </button>
          </div>

          {/* Variable Reference Help */}
          {formData.type === 'variable' && Object.keys(variables).length > 0 && (
            <div className="text-[8px] text-gray-600 dark:text-gray-400 p-1 bg-gray-100 dark:bg-gray-800 rounded">
              <strong>Available variables:</strong>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {Object.keys(variables).map(varName => (
                  <code
                    key={varName}
                    className="bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-700"
                    onClick={() => setFormData(prev => ({ 
                      ...prev, 
                      value: `{{variables.${varName}}}` 
                    }))}
                    title="Click to insert"
                  >
                    {`{{variables.${varName}}}`}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FileUploadSection;
