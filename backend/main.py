from fastapi import FastAPI
import models
from database import engine

# Create the database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vasool API", description="Centralized Hostel Expense Manager")


@app.get("/")
def read_root():
    return {"message": "Welcome to the Vasool API!"}
