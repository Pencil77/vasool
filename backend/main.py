from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
import models
import schemas
from database import engine, get_db

# Create the database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vasool API", description="Centralized Hostel Expense Manager")


@app.get("/")
def read_root():
    return {"message": "Welcome to the Vasool API!"}


@app.post("/users/", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    fake_hashed_password = user.password + "notreallyhashed"
    db_user = models.User(
        email=user.email, hashed_password=fake_hashed_password, name=user.name
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@app.post("/gangs/", response_model=schemas.GangResponse)
def create_gang(gang: schemas.GangCreate, user_id: int, db: Session = Depends(get_db)):
    db_gang = models.Gang(name=gang.name, leader_id=user_id)
    db.add(db_gang)
    db.commit()
    db.refresh(db_gang)

    participant = models.GangParticipant(
        gang_id=db_gang.id,
        user_id=user_id,
        role=models.RoleEnum.LEADER.value,
        status=models.StatusEnum.ACCEPTED.value,
    )
    db.add(participant)
    db.commit()
    return db_gang


@app.post(
    "/gangs/{gang_id}/participants/", response_model=schemas.GangParticipantResponse
)
def add_gang_participant(
    gang_id: int,
    participant: schemas.GangParticipantCreate,
    db: Session = Depends(get_db),
):
    db_participant = models.GangParticipant(
        gang_id=gang_id,
        user_id=participant.user_id,
        display_name=participant.display_name,
        role=participant.role.value,
        status=participant.status.value,
        delegated_to_id=participant.delegated_to_id,
    )
    db.add(db_participant)
    db.commit()
    db.refresh(db_participant)
    return db_participant


@app.post("/gangs/{gang_id}/expenses/", response_model=schemas.ExpenseResponse)
def create_expense(
    gang_id: int, expense: schemas.ExpenseCreate, db: Session = Depends(get_db)
):
    db_expense = models.Expense(
        gang_id=gang_id,
        description=expense.description,
        total_amount=expense.total_amount,
        paid_by_id=expense.paid_by_id,
    )
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)

    for split in expense.splits:
        db_split = models.ExpenseSplit(
            expense_id=db_expense.id,
            participant_id=split.participant_id,
            amount_owed=split.amount_owed,
        )
        db.add(db_split)
    db.commit()
    db.refresh(db_expense)
    return db_expense
