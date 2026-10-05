import { createHashRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { AddQuestionsPage } from './pages/AddQuestionsPage';
import { HomePage } from './pages/HomePage';
import { QuizBuilderPage } from './pages/QuizBuilderPage';
import { QuizPage } from './pages/QuizPage';
import { QuizReviewPage } from './pages/QuizReviewPage';

// Hash routing so deep links work on any static host (GitHub Pages has no SPA fallback).
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/add', element: <AddQuestionsPage /> },
      { path: '/quiz/new', element: <QuizBuilderPage /> },
      { path: '/quiz/:id', element: <QuizPage /> },
      { path: '/quiz/:id/review', element: <QuizReviewPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
