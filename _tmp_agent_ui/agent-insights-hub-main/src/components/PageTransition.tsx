 import { motion, AnimatePresence } from 'framer-motion';
 import { useLocation } from 'react-router-dom';
 import { ReactNode } from 'react';
 
 interface PageTransitionProps {
   children: ReactNode;
 }
 
 const pageVariants = {
   initial: {
     opacity: 0,
     y: 20,
     scale: 0.98,
   },
   enter: {
     opacity: 1,
     y: 0,
     scale: 1,
     transition: {
       duration: 0.4,
       ease: 'easeOut' as const,
     },
   },
   exit: {
     opacity: 0,
     y: -20,
     scale: 0.98,
     transition: {
       duration: 0.3,
       ease: 'easeOut' as const,
     },
   },
 };
 
 export function PageTransition({ children }: PageTransitionProps) {
   const location = useLocation();
 
   return (
     <AnimatePresence mode="wait">
       <motion.div
         key={location.pathname}
         initial="initial"
         animate="enter"
         exit="exit"
         variants={pageVariants}
         className="min-h-screen"
       >
         {children}
       </motion.div>
     </AnimatePresence>
   );
 }