import React from 'react';
import {GAMES,GAME_IDS} from '../shared/games';
export function GameOptions({ids=GAME_IDS}){return <>{ids.map(id=><option value={id} key={id}>{GAMES[id].short}</option>)}</>;}
