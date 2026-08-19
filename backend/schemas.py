from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from decimal import Decimal
from models import RoleEnum, StatusEnum


class UserBase(BaseModel):
    email: str
    name: str


class UserCreate(UserBase):
    password: str


class UserSignup(BaseModel):
    email: str
    name: str
    password: str


class UserVerify(BaseModel):
    email: str
    code: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(UserBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class GangBase(BaseModel):
    name: str
    is_live_publish: bool = True
    show_event_amounts: bool = True


class GangCreate(GangBase):
    pass


class GangResponse(GangBase):
    id: int
    leader_id: int
    model_config = ConfigDict(from_attributes=True)


class GangParticipantBase(BaseModel):
    user_id: Optional[int] = None
    display_name: Optional[str] = None
    role: RoleEnum = RoleEnum.TEMPORARY
    status: StatusEnum = StatusEnum.PENDING
    delegated_to_id: Optional[int] = None


class GangParticipantCreate(GangParticipantBase):
    pass


class GangParticipantResponse(GangParticipantBase):
    id: int
    gang_id: int
    model_config = ConfigDict(from_attributes=True)


class ExpenseSplitBase(BaseModel):
    participant_id: int
    amount_owed: Decimal


class ExpenseSplitCreate(ExpenseSplitBase):
    pass


class ExpenseSplitResponse(ExpenseSplitBase):
    id: int
    expense_id: int
    model_config = ConfigDict(from_attributes=True)


class ExpenseBase(BaseModel):
    description: str
    total_amount: Decimal
    paid_by_id: int
    is_published: bool = True


class ExpenseCreate(ExpenseBase):
    splits: List[ExpenseSplitCreate]


class ExpenseResponse(ExpenseBase):
    id: int
    gang_id: int
    splits: List[ExpenseSplitResponse] = []
    model_config = ConfigDict(from_attributes=True)
