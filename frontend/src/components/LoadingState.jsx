function LoadingState({ isLoading, children }) {
  if (isLoading) {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    );
  }
  return children;
}

export default LoadingState;
