import { useContext } from 'react';
import { ToastContext } from './toastContextShared.js';

export function useToast() {
  return useContext(ToastContext);
}
