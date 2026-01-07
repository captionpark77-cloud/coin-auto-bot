
import React from 'react';

interface InputGroupProps {
  label: string;
  icon: string;
  type: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { label: string; value: string }[];
}

const InputGroup: React.FC<InputGroupProps> = ({
  label,
  icon,
  type,
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  unit,
  options
}) => {
  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center">
        <i className={`fas ${icon} mr-2 text-blue-500`}></i>
        {label}
      </label>
      <div className="relative">
        {type === 'select' ? (
          <select
            value={value}
            onChange={onChange}
            className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all appearance-none shadow-sm"
          >
            {options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center">
            <input
              type={type}
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              min={min}
              max={max}
              step={step}
              className="w-full bg-white border border-slate-200 rounded-xl py-3 px-4 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all shadow-sm"
            />
            {unit && (
              <span className="absolute right-4 text-slate-400 font-medium">{unit}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InputGroup;
