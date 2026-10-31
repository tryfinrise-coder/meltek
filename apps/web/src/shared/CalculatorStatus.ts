import { createContext, type Dispatch, type SetStateAction } from 'react';
export interface CalculatorStatus { text: string; mode: string; ready: boolean }
export const CalculatorStatusContext = createContext<Dispatch<SetStateAction<CalculatorStatus | null>> | null>(null);
