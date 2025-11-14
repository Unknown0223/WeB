import React, { useState } from 'react';

const TextInput = ({
  label,
  type = 'text',
  placeholder = '',
  value = '',
  onChange = () => {},
  error = '',
  className = '',
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className={`mb-4 ${className}`}>
      {label && (
        <label className="block text-gray-700 text-sm font-bold mb-2">
          {label}
        </label>
      )}
      <div
        className={`relative rounded-md shadow-sm transition-all duration-200 ${
          isFocused ? 'ring-2 ring-blue-500' : ''
        }`}
      >
        <input
          type={type}
          className={`
            appearance-none border rounded w-full py-2 px-3 
            text-gray-700 leading-tight focus:outline-none
            ${error ? 'border-red-500' : 'border-gray-300'}
          `}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...props}
        />
      </div>
      {error && <p className="text-red-500 text-xs italic mt-1">{error}</p>}
    </div>
  );
};

export default TextInput;
