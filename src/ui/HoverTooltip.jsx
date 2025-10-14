import React, { useEffect, useRef, useState } from 'react';

export default function HoverTooltip({ content, delay = 1000, children, wrapperStyle }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleMouseEnter = () => {
    if (!content) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  const mergedStyle = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    ...wrapperStyle,
  };

  return (
    <span style={mergedStyle} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {children}
      {visible ? (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 60, 15, 0.95)',
            color: '#f2fff2',
            padding: '6px 8px',
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.3,
            maxWidth: 220,
            textAlign: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
            zIndex: 20,
            whiteSpace: 'normal',
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
