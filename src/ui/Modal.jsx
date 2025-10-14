import React from 'react';

export default function Modal({ open, onClose, title, children, width = 'min(90vw, 800px)' }) {
    if (!open) return null;

    const handleOverlayClick = (evt) => {
        if (evt.target === evt.currentTarget && onClose) {
            onClose();
        }
    };

    return (
        <div
            onClick={handleOverlayClick}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.65)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20,
                zIndex: 1000,
            }}
        >
            <div
                style={{
                    width,
                    maxHeight: '90vh',
                    background: '#062c06',
                    color: '#e8ffe8',
                    border: '1px solid #0b4a0b',
                    borderRadius: 12,
                    boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 16px',
                        borderBottom: '1px solid #0b4a0b',
                        fontWeight: 700,
                        fontSize: 16,
                        background: '#083b08',
                    }}
                >
                    <span>{title}</span>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: '1px solid rgba(232,255,232,0.4)',
                            color: '#e8ffe8',
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontSize: 12,
                            cursor: 'pointer',
                        }}
                    >
                        Close
                    </button>
                </div>
                <div
                    style={{
                        padding: '12px 16px',
                        overflowX: 'hidden',
                        overflowY: 'auto',
                        flex: 1,
                        minHeight: 0,
                    }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
