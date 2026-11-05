import React from 'react';
import {LEGAL_LINKS} from '../shared/legal';
import './legal.css';

export function LegalLinks({className=''}){return <nav className={'legal-links '+className} aria-label="Legal policies">{LEGAL_LINKS.map(([href,label])=><a key={href} href={href}>{label}</a>)}</nav>;}
