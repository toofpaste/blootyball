import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function HoverTooltip({ content, delay = 1000, children, wrapperStyle }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const wrapperRef = useRef(null);
  const tooltipRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

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

  useLayoutEffect(() => {
    if (!visible) return undefined;
    if (typeof window === 'undefined') return undefined;

    const updatePosition = () => {
      const wrapper = wrapperRef.current;
      const tooltip = tooltipRef.current;
      if (!wrapper || !tooltip) return;

      const wrapperRect = wrapper.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

      let top = wrapperRect.top - tooltipRect.height - 8;
      if (top < 8) {
        top = wrapperRect.bottom + 8;
      }
      if (top + tooltipRect.height > viewportHeight - 8) {
        top = Math.max(8, wrapperRect.top - tooltipRect.height - 8);
      }

      let left = wrapperRect.left + wrapperRect.width / 2 - tooltipRect.width / 2;
      const maxLeft = viewportWidth - tooltipRect.width - 8;
      left = Math.max(8, Math.min(left, maxLeft));

      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [visible, content]);

  const mergedStyle = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    ...wrapperStyle,
  };

  const tooltipNode = (visible && typeof document !== 'undefined')
    ? createPortal(
      <span
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          transform: 'none',
          background: 'rgba(15, 60, 15, 0.97)',
          color: '#f2fff2',
          padding: '8px 10px',
          borderRadius: 8,
          fontSize: 11,
          lineHeight: 1.35,
          maxWidth: 280,
          textAlign: 'center',
          boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
          pointerEvents: 'none',
          zIndex: 4000,
          whiteSpace: 'normal',
        }}
      >
        {content}
      </span>,
      document.body,
    )
    : null;

  return (
    <span ref={wrapperRef} style={mergedStyle} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {children}
      {tooltipNode}
    </span>
  );
}
