from fastapi import FastAPI

app = FastAPI(title="Vasool API", description="Centralized Hostel Expense Manager")

@app.get("/")
def read_root():
    return {"message": "Welcome to the Vasool API!"}
