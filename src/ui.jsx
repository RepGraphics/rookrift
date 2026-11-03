import React from 'react';
import { Server } from 'lucide-react';
export const Button = ({ children, icon: Icon, secondary, quiet, danger, className = '', ...props }) => <button className={`button ${secondary ? 'secondary' : ''} ${quiet ? 'quiet' : ''} ${danger ? 'danger' : ''} ${className}`} {...props}>{Icon && <Icon size={16}/>} {children}</button>;
export const Field = ({ label, children, hint }) => <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
export const Empty = ({ icon: Icon = Server, title, detail, children }) => <div className="empty"><Icon size={32}/><h3>{title}</h3><p>{detail}</p>{children}</div>;
